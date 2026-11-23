import { EventEmitter } from "node:events";
import { lstat, mkdir, readFile, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ArtifactStore, repositoryKey } from "./store.mjs";
import { normalizeAssessment, validateBundle } from "./assessment.mjs";
import { CopilotBridge } from "./copilot-bridge.mjs";
import { prepareHandoff, assertHandoffCurrent } from "./handoff.mjs";
import { collectSource, stageSource, unchanged, decodeSource, inspectSourceText, discoverApplications, validateCandidate, sourceCandidates, resolvePreviewFile, sourceExcerpt, relativeSourcePath } from "./source.mjs";
import { coverageGaps, readinessCards, reviewFields, reviewGoals, sourceRelationship } from "./review.mjs";
import { digest, fail, identifier, inside, newId, object, parseJson, publicError, readLimited, scopedPath, text } from "./common.mjs";

const activeStates = new Set(["awaiting approval", "running", "cancellation requested", "status unknown"]);
const quote = value => `'${value.replaceAll("'", "''")}'`;

export class Workbench {
    constructor(session, root, log) {
        this.session = session;
        this.root = root;
        this.log = log;
        this.events = new EventEmitter();
        this.store = new ArtifactStore(path.join(root, "records"));
        this.pending = new Set();
        this.appCandidates = new Map();
        this.problem = null;
        this.bridge = new CopilotBridge(session, {
            received: (id, response) => this.systemUpdate(data => {
                const thread = data.threads.find(item => item.id === id);
                if (!thread || thread.responses.some(item => item.messageId === response.messageId)) return data;
                thread.responses.push(response);
                thread.status = "answered";
                return data;
            }),
            failed: (id, error) => this.backgroundFailure(error, id),
        });
    }

    async initialize() {
        const metadata = await this.session.rpc.metadata.snapshot();
        if (metadata.isRemote) fail("local_required", "Open this personal workbench in a local project session.");
        this.workspace = await realpath(metadata.workingDirectory);
        this.sessionWorkspace = metadata.workspacePath;
        this.id = repositoryKey(this.workspace);
        try {
            await this.store.read(this.id);
        } catch (error) {
            if (error.code !== "not_found") throw error;
            try {
                await this.store.create(this.id, { schemaVersion: 1, assessments: [], decisions: [], threads: [], jobs: [], handoffs: [], audit: [] });
            } catch (createError) {
                if (createError.code !== "already_exists") throw createError;
            }
        }
        const record = await this.store.read(this.id);
        if (record.data.schemaVersion !== 1) fail("unsupported_store", "Unsupported workbench storage version.");
        this.bridge.restore(record.data.threads);
        if (record.data.jobs.some(job => activeStates.has(job.status))) {
            await this.systemUpdate(data => {
                for (const job of data.jobs) if (activeStates.has(job.status)) {
                    job.status = "status unknown";
                    job.message = "The provider restarted. Native work may still be running; inspect its native command before retrying.";
                }
                return data;
            });
        }
    }

    subscribe(handler) {
        this.events.on("changed", handler);
        return () => this.events.off("changed", handler);
    }

    async state() {
        const record = await this.store.read(this.id);
        const approvals = this.session.capabilities.ui?.elicitation === true;
        const capabilities = {
                approvals,
                nativeRuns: approvals && !!this.sessionWorkspace,
                nativePlans: false,
                reasons: [
                    ...(!approvals ? ["Native confirmation is unavailable in this host. Live jobs cannot start."] : []),
                    ...(!this.sessionWorkspace ? ["A persistent session workspace is required for isolated jobs."] : []),
                    ".NET native report verification is blocked by the AppCAT NuGet TLS/service-index failure. Its live run profile is not enabled.",
                    "Native planning is currently blocked by the installed Modernize/Copilot standalone-extension compatibility error.",
                    ...(this.problem ? [this.problem.message] : []),
                ],
            };
        const review = reviewFields(record.data);
        const context = review.reviewContexts.find(item => item.id === review.activeReviewContextId);
        return {
            ...record.data,
            revision: record.revision,
            workspace: { name: path.basename(this.workspace), path: this.workspace },
            capabilities,
            ...review,
            readiness: readinessCards(capabilities),
            gaps: Object.fromEntries(record.data.assessments.map(assessment => [assessment.id, coverageGaps(assessment, review.sourceBindings.find(item => item.assessmentId === assessment.id), capabilities.nativeRuns && context?.app.language === "java")])),
            sourceRelationships: Object.fromEntries(record.data.assessments.map(assessment => [assessment.id, sourceRelationship(assessment, review.sourceBindings.find(item => item.assessmentId === assessment.id))])),
        };
    }

    async systemUpdate(change) {
        for (let attempt = 0; attempt < 4; attempt++) {
            const record = await this.store.read(this.id);
            try {
                const updated = await this.store.update(this.id, record.revision, change);
                this.events.emit("changed");
                return updated;
            } catch (error) {
                if (!["stale_revision", "artifact_busy"].includes(error.code) || attempt === 3) throw error;
                await delay(20 * (attempt + 1));
            }
        }
    }

    async backgroundFailure(error, threadId) {
        this.log(error);
        this.problem = publicError(error);
        if (threadId) {
            try {
                await this.systemUpdate(data => {
                    const thread = data.threads.find(item => item.id === threadId);
                    if (thread) { thread.status = "failed"; thread.error = this.problem.message; }
                    return data;
                });
            } catch (storeError) {
                this.log(storeError);
            }
        }
        this.events.emit("changed");
    }

    track(promise) {
        this.pending.add(promise);
        void promise.catch(error => this.backgroundFailure(error)).finally(() => this.pending.delete(promise));
    }

    async evidence(assessmentId, id) {
        identifier(assessmentId);
        identifier(id);
        const record = await this.store.read(this.id);
        const reference = record.data.assessments.find(item => item.id === assessmentId)?.evidence.find(item => item.id === id);
        if (!reference) fail("not_found", "Evidence does not belong to the selected assessment.", 404);
        return reference;
    }

    assessment(data, id) {
        identifier(id);
        const assessment = data.assessments.find(item => item.id === id);
        if (!assessment) fail("not_found", "Assessment does not belong to this workspace.", 404);
        return assessment;
    }

    async importFiles(input, source = null) {
        const files = validateBundle(input);
        const assessment = normalizeAssessment(files, source);
        const existing = (await this.store.read(this.id)).data.assessments.find(item => item.contentDigest === assessment.contentDigest);
        if (existing) return { assessmentId: existing.id, duplicate: true };
        const rawRoot = path.join(this.root, "native", assessment.id);
        await mkdir(rawRoot, { recursive: true });
        await writeFile(path.join(rawRoot, "bundle.json"), JSON.stringify(files), { flag: "wx", mode: 0o600 });
        let admittedId = assessment.id;
        await this.systemUpdate(data => {
            const duplicate = data.assessments.find(item => item.contentDigest === assessment.contentDigest);
            if (duplicate) {
                admittedId = duplicate.id;
            } else {
                data.assessments.push(assessment);
                data.audit.push({ type: "assessment_imported", assessmentId: assessment.id, digest: assessment.contentDigest, at: new Date().toISOString() });
            }
            return data;
        });
        if (admittedId !== assessment.id) {
            await unlink(path.join(rawRoot, "bundle.json"));
            await rmdir(rawRoot);
        }
        return { assessmentId: admittedId };
    }

    async action(name, input) {
        switch (name) {
            case "discover_apps":
            case "save_review_context":
            case "link_current_source":
            case "unlink_current_source":
                return this.reviewAction(name, input);
            case "request_source_preview": return this.sourcePreview(input);
            case "import_files": return this.importFiles(input);
            case "decide": {
                object(input, ["assessmentId", "findingId", "state", "rationale", "revision"]);
                text(input.rationale, "Decision rationale", 6000);
                if (!["include", "defer", "exclude"].includes(input.state)) fail("invalid_decision", "Choose include, defer, or exclude.");
                const updated = await this.store.update(this.id, input.revision, data => {
                    const assessment = this.assessment(data, input.assessmentId);
                    if (!assessment.findings.some(item => item.id === input.findingId)) fail("invalid_finding", "Finding does not belong to this assessment.");
                    const previous = data.decisions.find(item => item.assessmentId === input.assessmentId && item.findingId === input.findingId);
                    const decision = { assessmentId: input.assessmentId, findingId: input.findingId, state: input.state, rationale: input.rationale };
                    data.decisions = data.decisions.filter(item => item !== previous);
                    data.decisions.push(decision);
                    data.audit.push({ type: "decision", before: previous ?? null, after: decision, at: new Date().toISOString() });
                    return data;
                });
                this.events.emit("changed");
                return { revision: updated.revision };
            }
            case "ask": {
                object(input, ["assessmentId", "selection", "question", "destination", "constraints"]);
                text(input.question, "Question", 6000);
                const record = await this.store.read(this.id);
                const assessment = this.assessment(record.data, input.assessmentId);
                const selection = input.selection;
                let entity = null;
                if (selection !== null && selection !== undefined) {
                    object(selection, ["kind", "id"]);
                    if (!["finding", "component", "insight"].includes(selection.kind)) fail("invalid_selection", "Choose a finding, component, or insight.");
                    const collection = { finding: assessment.findings, component: assessment.components, insight: assessment.insights }[selection.kind];
                    entity = collection?.find(item => item.id === selection.id);
                    if (!entity) fail("invalid_selection", "The selected context is not part of this assessment.");
                }
                const related = selection?.kind === "component" ? assessment.findings.filter(item => item.componentIds.includes(entity.id)).slice(0, 40) : [];
                const referenceIds = new Set([...(entity?.evidenceIds ?? []), ...related.flatMap(item => item.evidenceIds)]);
                const evidence = entity ? assessment.evidence.filter(item => referenceIds.has(item.id)) : [];
                const context = {
                    assessmentId: assessment.id, application: assessment.name, source: assessment.sourceLabel,
                    coverage: assessment.coverage, destination: typeof input.destination === "string" ? input.destination.slice(0, 2000) : "",
                    constraints: typeof input.constraints === "string" ? input.constraints.slice(0, 10000) : "",
                    entity, evidence,
                    findings: entity ? related : assessment.findings.slice(0, 40),
                    omittedFindings: entity ? 0 : Math.max(0, assessment.findings.length - 40),
                };
                if (Buffer.byteLength(JSON.stringify(context)) > 96 * 1024) fail("context_limit", "Select a smaller evidence scope for this question.");
                const id = newId("thread");
                await this.systemUpdate(data => {
                    data.threads.push({ id, assessmentId: assessment.id, entityId: entity?.id ?? null, question: input.question, contextDigest: digest(context), status: "queued", responses: [], ownerSessionId: this.session.sessionId, nativeMessageId: null });
                    return data;
                });
                try {
                    const messageId = await this.bridge.submit(id, input.question, context);
                    await this.systemUpdate(data => { data.threads.find(item => item.id === id).nativeMessageId = messageId; return data; });
                    return { threadId: id };
                } catch (error) {
                    await this.backgroundFailure(error, id);
                    throw error;
                }
            }
            case "prepare_handoff": {
                object(input, ["assessmentId", "revision", "destination", "constraints"]);
                let packet;
                await this.store.update(this.id, input.revision, data => {
                    packet = prepareHandoff(this.assessment(data, input.assessmentId), data.decisions, input.destination, input.constraints);
                    data.handoffs.push(packet);
                    return data;
                });
                this.events.emit("changed");
                return { handoffId: packet.id };
            }
            case "send_handoff": {
                object(input, ["handoffId", "revision"]);
                const record = await this.store.read(this.id);
                if (record.revision !== input.revision) fail("stale_revision", "Refresh and review the current packet before sending.", 409);
                const packet = record.data.handoffs.find(item => item.id === input.handoffId);
                if (!packet) fail("not_found", "Handoff was not found.", 404);
                assertHandoffCurrent(packet, this.assessment(record.data, packet.assessmentId), record.data.decisions);
                if (packet.status !== "draft review request") fail("already_sent", "This packet was sent or has an uncertain receipt; do not resubmit it.", 409);
                if (!(await this.bridge.confirm(`Send this packet to the current Copilot session for Upgrade review only? It does not authorize implementation.\n\n${packet.body}`))) return { cancelled: true };
                const fresh = await this.store.read(this.id);
                if (fresh.revision !== input.revision) fail("stale_handoff", "The workbench changed while confirmation was open. Review again.", 409);
                const reserved = await this.store.update(this.id, input.revision, data => {
                    data.handoffs.find(item => item.id === packet.id).status = "sending; receipt pending";
                    return data;
                });
                this.events.emit("changed");
                try {
                    const messageId = await this.session.send({ prompt: packet.body, source: "system", mode: "enqueue" });
                    await this.systemUpdate(data => {
                        const stored = data.handoffs.find(item => item.id === packet.id);
                        stored.status = "sent for review"; stored.nativeMessageId = messageId;
                        return data;
                    });
                    return { messageId, revision: reserved.revision };
                } catch (error) {
                    await this.backgroundFailure(error);
                    throw error;
                }
            }
            case "request_assessment": return this.requestAssessment(input);
            case "cancel_job": return this.cancelJob(input);
            case "request_plan":
                fail("native_plan_unavailable", "Native plan creation failed its compatibility check: Modernize's Copilot session requires extensionSdkPath. Review the evidence packet in Copilot instead; no native plan was claimed or generated.", 409);
            default: fail("unknown_action", "This workbench does not support that action.", 404);
        }
    }

    async checkPaths(paths) {
        for (let index = 0; index < paths.length; index += 100) {
            const batch = paths.slice(index, index + 100);
            const result = await this.session.rpc.contentExclusion.checkPaths({ paths: batch });
            if (!result.available || result.checks.length !== batch.length || result.checks.some((check, offset) => check.excluded || check.path !== batch[offset])) return false;
        }
        return true;
    }

    async reviewAction(name, input) {
        if (name === "discover_apps") {
            object(input, ["relativePath"]);
            const result = await discoverApplications(this.workspace, input.relativePath || ".", paths => this.checkPaths(paths));
            for (const app of result.candidates) this.appCandidates.set(app.id, app);
            return result;
        }
        const record = await this.store.read(this.id);
        const review = reviewFields(record.data);
        if (name === "save_review_context") {
            object(input, ["candidateId", "goal", "notes", "revision"]);
            identifier(input.candidateId);
            if (!reviewGoals.includes(input.goal)) fail("invalid_goal", "Choose a supported review goal.");
            if (typeof input.notes !== "string" || input.notes.length > 6000) fail("invalid_notes", "Review notes must be text of at most 6,000 characters.");
            const selected = this.appCandidates.get(input.candidateId) ?? review.reviewContexts.find(item => item.app.id === input.candidateId)?.app;
            if (!selected) fail("candidate_unavailable", "Discover this app candidate before selecting it.");
            const app = await validateCandidate(this.workspace, selected, paths => this.checkPaths(paths));
            const context = { id: `context-${digest(app.id).slice(0, 24)}`, app, goal: input.goal, notes: input.notes, savedAt: new Date().toISOString() };
            await this.store.update(this.id, input.revision, data => {
                const fields = reviewFields(data);
                data.reviewContexts = [...fields.reviewContexts.filter(item => item.id !== context.id), context];
                data.activeReviewContextId = context.id;
                data.audit.push({ type: "review_context_saved", contextId: context.id, at: context.savedAt });
                return data;
            });
            this.events.emit("changed");
            return { contextId: context.id };
        }
        if (name === "link_current_source") {
            object(input, ["contextId", "assessmentId", "revision"]);
            const context = review.reviewContexts.find(item => item.id === input.contextId);
            if (!context) fail("context_unavailable", "Save an app review context before linking source.");
            const assessment = this.assessment(record.data, input.assessmentId);
            if (assessment.language === "Java" && context.app.language !== "java") fail("language_mismatch", "This Java report cannot be linked to a .NET candidate.");
            const app = await validateCandidate(this.workspace, context.app, paths => this.checkPaths(paths));
            const binding = { id: `binding-${digest(assessment.id).slice(0, 24)}`, assessmentId: assessment.id, contextId: context.id, appId: app.id,
                relativePath: app.relativePath, language: app.language, provenance: "user-linked-current", revision: input.revision + 1 };
            await this.store.update(this.id, input.revision, data => {
                const fields = reviewFields(data);
                data.sourceBindings = [...fields.sourceBindings.filter(item => item.assessmentId !== assessment.id), binding];
                data.audit.push({ type: "current_source_linked", assessmentId: assessment.id, appId: app.id, at: new Date().toISOString() });
                return data;
            });
            this.events.emit("changed");
            return { bindingId: binding.id };
        }
        object(input, ["assessmentId", "revision"]);
        this.assessment(record.data, input.assessmentId);
        await this.store.update(this.id, input.revision, data => {
            data.sourceBindings = reviewFields(data).sourceBindings.filter(item => item.assessmentId !== input.assessmentId);
            return data;
        });
        this.events.emit("changed");
        return { unlinked: true };
    }

    async sourceReference(assessment, reference) {
        if (typeof reference.projectPath === "string" || !reference.sourcePath) return reference;
        const bundlePath = path.join(this.root, "native", identifier(assessment.id), "bundle.json");
        let files;
        try { files = validateBundle({ files: parseJson(await readLimited(bundlePath, 64 * 1024 * 1024), "Native bundle") }); }
        catch (error) {
            if (error.code === "ENOENT") fail("source_metadata_unavailable", "The original bundle is unavailable. Report evidence remains viewable, but its source mapping cannot be recovered.");
            throw error;
        }
        if (digest(files.slice().sort((a, b) => a.name.localeCompare(b.name))) !== assessment.contentDigest) fail("bundle_changed", "The native bundle no longer matches this assessment. Source mapping was not trusted.");
        const original = files.find(file => file.name === reference.artifact);
        const indices = /^#\/projects\/(\d+)\/incidents\/(\d+)$/.exec(reference.locator);
        if (!original || !indices) fail("source_metadata_unavailable", "This evidence has no recoverable file mapping.");
        const report = parseJson(Buffer.from(original.content), "Native report");
        const project = report.projects?.[Number(indices[1])];
        const incident = project?.incidents?.[Number(indices[2])];
        if (typeof project?.path !== "string" || incident?.location !== reference.sourcePath) fail("source_metadata_unavailable", "The report and source reference do not agree.");
        return { ...reference, projectPath: project.path };
    }

    async sourcePreview(input) {
        object(input, ["assessmentId", "evidenceId", "mode", "relativeFile", "navigation", "revision"]);
        if (!["snapshot", "current"].includes(input.mode)) fail("invalid_preview_mode", "Choose snapshot or current-source preview.");
        if (input.navigation !== undefined && typeof input.navigation !== "boolean") fail("invalid_input", "Navigation must be a boolean.");
        if (input.relativeFile !== undefined && typeof input.relativeFile !== "string") fail("invalid_input", "The mapping must be a relative path.");
        const record = await this.store.read(this.id);
        if (record.revision !== input.revision) fail("stale_revision", "The review context changed. Refresh before requesting source.", 409);
        const assessment = this.assessment(record.data, input.assessmentId);
        const original = assessment.evidence.find(item => item.id === input.evidenceId);
        if (!original) fail("invalid_evidence", "The reference does not belong to this assessment.");
        if (!original.sourcePath) return { status: "report_only", message: "This is application-level or document evidence, with no reported source file.", lines: [] };
        const reference = await this.sourceReference(assessment, original);
        const candidates = sourceCandidates(reference);
        const binding = reviewFields(record.data).sourceBindings.find(item => item.assessmentId === assessment.id);
        let root;
        let selectedPaths = candidates;
        let manifest = [];
        if (input.mode === "snapshot") {
            if (!assessment.source?.runRoot || !Array.isArray(assessment.source.files) || !this.sessionWorkspace) {
                return { status: "snapshot_unavailable", message: "No owned assessment snapshot is recorded. Do not substitute current files as historical evidence.", lines: [] };
            }
            const job = record.data.jobs.find(item => item.assessmentId === assessment.id && item.runRoot === assessment.source.runRoot && item.ownerSessionId === this.session.sessionId);
            const allowed = path.join(this.sessionWorkspace, "files", "modernization-workbench", "runs");
            if (!job || !inside(allowed, path.resolve(assessment.source.runRoot))) {
                return { status: "snapshot_unavailable", message: "The snapshot is foreign to this session or unavailable. Use report evidence or explicitly linked current source.", lines: [] };
            }
            root = path.join(assessment.source.runRoot, "source");
            try {
                const canonical = await scopedPath(allowed, path.relative(allowed, root), { directory: true });
                if (path.relative(path.resolve(root), canonical) !== "") fail("snapshot_boundary", "The snapshot root changed its mapping.");
                root = canonical;
            } catch (error) {
                if (error.code === "ENOENT") return { status: "snapshot_unavailable", message: "The owned snapshot has expired or been removed. Report evidence is still available.", lines: [] };
                throw error;
            }
            manifest = assessment.source.files;
            for (const file of manifest) {
                relativeSourcePath(file.path);
                if (!/^[a-f0-9]{64}$/.test(file.digest)) fail("snapshot_manifest", "The snapshot manifest is invalid.");
            }
            selectedPaths = candidates.filter(relative => manifest.some(file => path.normalize(file.path) === relative));
            if (input.relativeFile && !selectedPaths.includes(relativeSourcePath(input.relativeFile))) fail("invalid_mapping", "A snapshot mapping must be both reported and admitted in its manifest.");
        } else {
            if (!binding) return { status: "source_unlinked", message: "Choose an app in Start and explicitly link its current source to this report.", lines: [] };
            try { root = await scopedPath(this.workspace, binding.relativePath, { directory: true }); }
            catch (error) {
                if (error.code === "ENOENT") return { status: "missing", message: "The linked application folder no longer exists. Discover and link its current location again.", lines: [] };
                throw error;
            }
            if (path.relative(path.resolve(this.workspace, binding.relativePath), root) !== "") fail("source_link_changed", "The linked app changed its root mapping. Link it again before reading files.");
        }
        let resolved;
        try { resolved = await resolvePreviewFile(root, selectedPaths, input.relativeFile || undefined); }
        catch (error) {
            if (error.code === "ENOENT") return { status: "missing", message: "The selected source root or snapshot no longer exists.", lines: [] };
            throw error;
        }
        if (resolved.status !== "resolved") return { ...resolved, lines: [] };
        const policyPath = input.mode === "current" ? resolved.file : path.resolve(assessment.source.root, resolved.relativePath);
        if (!inside(this.workspace, policyPath) || !(await this.checkPaths([policyPath]))) fail("content_excluded", "Source access is excluded or policy evaluation is unavailable. No source content was read.", 403);
        if (input.mode === "current") {
            if (!(await this.bridge.confirm(`Read this current source file for a bounded, read-only preview?\n\n${resolved.file}\n\nThis does not verify the file against the imported assessment, send it to AI, edit it, or authorize an assessment.`))) {
                return { status: "approval_declined", message: "Current source was not read because approval was declined.", lines: [] };
            }
            if ((await this.store.read(this.id)).revision !== input.revision) fail("stale_revision", "The review context changed while approval was open. Source was not read.", 409);
        }
        const checked = await scopedPath(root, resolved.relativePath);
        const info = await lstat(checked);
        if (`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}` !== resolved.version) fail("file_changed", "The source changed during approval. Request a fresh preview.");
        if (!(await this.checkPaths([policyPath]))) fail("content_excluded", "Source policy changed. No source content was read.", 403);
        const bytes = await this.readPreviewFile(checked);
        const hash = digest(bytes);
        const expected = manifest.find(file => path.normalize(file.path) === resolved.relativePath)?.digest;
        if (input.mode === "snapshot" && (!expected || hash !== expected)) fail("snapshot_changed", "Snapshot bytes do not match the recorded manifest. No verified preview was returned.");
        const content = decodeSource(bytes);
        inspectSourceText(content);
        let kind = input.mode === "snapshot" ? "snapshot_matched" : "current_unverified";
        if (input.mode === "current" && assessment.source?.root && path.resolve(assessment.source.root) === path.resolve(root)) {
            const recorded = assessment.source.files?.find(file => path.normalize(file.path) === resolved.relativePath);
            if (recorded?.digest === hash) kind = "current_matches_snapshot";
        }
        return { ...sourceExcerpt(content, reference.line, input.navigation === true), kind, fileLabel: resolved.relativePath, digest: hash,
            reportedLine: reference.line ?? null, mapping: input.relativeFile ? "user-selected mapping" : "reported relative location",
            assessmentId: assessment.id, evidenceId: reference.id, bindingRevision: binding?.revision ?? null };
    }

    async readPreviewFile(file) {
        return readLimited(file, 2 * 1024 * 1024);
    }

    async requestAssessment(input) {
        object(input, ["relativePath", "language", "mode"]);
        text(input.relativePath, "Application folder", 2048);
        if (!["java", "dotnet"].includes(input.language) || !["full", "issues"].includes(input.mode)) fail("invalid_job", "Unsupported language or analysis mode.");
        if (input.language === "dotnet") fail("dotnet_contract_unavailable", "The native .NET report contract could not be verified because AppCAT installation failed against NuGet. No .NET run was started.", 409);
        if (!this.sessionWorkspace || !this.session.capabilities.ui?.elicitation) fail("approval_unavailable", "A persistent session and native confirmation are required. Nothing was started.", 409);
        const source = await collectSource(this.workspace, input.relativePath, input.language, paths => this.checkPaths(paths));
        if (input.mode === "full" && source.files.some(file => /connectionstrings|sqlconnection|oracleconnection|jdbc:|data source=/i.test(file.content))) {
            fail("database_boundary", "Full analysis can select database skills for this source. Live database access is out of scope: use issue-only analysis or import an externally approved report.", 409);
        }
        const id = newId("job");
        await this.systemUpdate(data => {
            if (data.jobs.some(job => job.sourceRoot === source.root && activeStates.has(job.status))) fail("job_active", "This application already has active or unconfirmed native work.", 409);
            data.jobs.push({ id, name: `${input.language} / ${input.mode} / ${input.relativePath}`, kind: "assess", status: "awaiting approval", message: "Waiting for native confirmation. No native assessment has started.", sourceRoot: source.root, ownerSessionId: this.session.sessionId });
            return data;
        });
        this.track(this.runAssessment(id, source, input.mode));
        return { jobId: id };
    }

    async setJob(id, changes) {
        return this.systemUpdate(data => {
            const job = data.jobs.find(item => item.id === id);
            if (!job) fail("not_found", "Job was not found.", 404);
            Object.assign(job, changes);
            return data;
        });
    }

    async runAssessment(id, source, mode) {
        let runRoot;
        try {
            const approved = await this.bridge.confirm([
                `Run a ${mode} Modernize assessment of this one ${source.language} application?`,
                `Source: ${source.root}`, `Inputs: ${source.files.length} files / ${source.byteLength} bytes`,
                `Source digest: ${source.digest}`,
                "Source will be copied into this session's isolated run folder. Local orchestration may use hosted AI, normal Modernize authentication, and native assessment dependencies.",
                "No upgrade, plan execution, deployment, database connection, commit, or GitHub write is authorized.",
                "Selected inputs:", ...source.files.map(file => file.path),
            ].join("\n"));
            const current = (await this.store.read(this.id)).data.jobs.find(item => item.id === id);
            if (!approved || current.status === "cancellation requested") {
                await this.setJob(id, { status: "cancelled", message: "No assessment was launched." });
                return;
            }
            if (!(await unchanged(source))) fail("source_changed", "The source changed during confirmation. Review a new request.");
            runRoot = path.join(this.sessionWorkspace, "files", "modernization-workbench", "runs", id);
            await mkdir(runRoot, { recursive: true });
            await stageSource(source, path.join(runRoot, "source"));
            await writeFile(path.join(runRoot, "request.json"), JSON.stringify({ id, kind: "assess", language: source.language, mode, sourceDigest: source.digest }), { flag: "wx", mode: 0o600 });
            const requestId = newId("native");
            await this.setJob(id, { status: "running", requestId, runRoot, message: "Native assessment running. Review its command in the Copilot timeline." });
            const command = `& 'node' ${quote(fileURLToPath(new URL("./runner.mjs", import.meta.url)))} ${quote(path.join(runRoot, "request.json"))}`;
            const result = await this.bridge.executeWorker(command, requestId);
            const job = (await this.store.read(this.id)).data.jobs.find(item => item.id === id);
            if (!result.success) {
                if (job.status === "cancellation requested") { await this.setJob(id, { status: "cancelled", message: "Native execution finished after the cancellation request." }); return; }
                fail("native_failed", `Native assessment failed. Inspect ${path.join(runRoot, "native.log")}. No assessment was marked complete.`, 502);
            }
            const resultRecord = parseJson(await readLimited(path.join(runRoot, "result.json")), "Worker result");
            if (resultRecord.exitCode !== 0 || resultRecord.error) fail("native_failed", "The native worker did not report success.", 502);
            const files = await collectReports(path.join(runRoot, "output"));
            const stillCurrent = await unchanged(source);
            const sourceRecord = { root: source.root, relativePath: source.relativePath, digest: source.digest, language: source.language, files: source.files.map(({ path: filePath, digest: hash }) => ({ path: filePath, digest: hash })), runRoot, stale: !stillCurrent };
            const imported = await this.importFiles({ files }, sourceRecord);
            const admitted = (await this.store.read(this.id)).data.assessments.find(item => item.id === imported.assessmentId);
            const incomplete = !stillCurrent || admitted.nativeStatus !== "Complete" || (mode === "full" && !admitted.insights.length);
            await this.setJob(id, { status: incomplete ? "completed with gaps" : "completed", message: !stillCurrent ? "Report imported, but original source changed and needs re-review." : incomplete ? "Native findings were imported, but required Full-analysis facts or native completion evidence are missing. Review coverage." : "Native report validated and imported. Review its coverage before making decisions.", assessmentId: imported.assessmentId, toolCallId: result.toolCallId });
        } catch (error) {
            this.log(error);
            await this.setJob(id, { status: "failed", message: publicError(error).message, ...(runRoot ? { runRoot } : {}) });
        }
    }

    async cancelJob(input) {
        object(input, ["id"]);
        const record = await this.store.read(this.id);
        const job = record.data.jobs.find(item => item.id === input.id);
        if (!job || job.ownerSessionId !== this.session.sessionId) fail("invalid_job", "Only this session's own jobs can be cancelled.");
        if (!activeStates.has(job.status)) fail("job_finished", "This job is not active.", 409);
        await this.setJob(job.id, { status: "cancellation requested", message: "Cancellation requested; waiting for native confirmation of termination." });
        if (job.requestId) await this.bridge.cancel(job.requestId);
        return { requested: true };
    }

    close() {
        this.bridge.close();
        this.events.removeAllListeners();
    }
}

export async function collectReports(root) {
    const files = [];
    async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) fail("unsafe_report", "Native output contains a link outside the report bundle.");
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile() && (/^report\.json$/i.test(entry.name) || (entry.name.endsWith(".md") && absolute.split(path.sep).includes("facts")))) {
                files.push({ name: path.relative(root, absolute).replaceAll("\\", "/"), content: (await readLimited(absolute)).toString("utf8") });
            }
        }
    }
    await walk(root);
    if (!files.length) fail("missing_report", "Modernize completed without a supported report.json. No assessment was imported.");
    return files;
}
