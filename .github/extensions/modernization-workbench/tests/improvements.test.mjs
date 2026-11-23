import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverApplications, sourceExcerpt, decodeSource } from "../source.mjs";
import { coverageGaps, readinessCards, reviewFields } from "../review.mjs";
import { normalizeAssessment } from "../assessment.mjs";
import { Workbench } from "../controller.mjs";
import { digest } from "../common.mjs";

async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-improvement-"));
    t.after(() => rm(root, { recursive: true }));
    for (const dir of ["java-app", "dotnet-app", "node_modules\\ignored", "java-app\\module"]) await mkdir(path.join(root, dir), { recursive: true });
    const xml = ["<project>", ...Array.from({ length: 15 }, (_, index) => `  <!-- synthetic line ${index + 2} -->`), "</project>"].join("\n");
    await writeFile(path.join(root, "java-app", "pom.xml"), xml);
    await writeFile(path.join(root, "java-app", "module", "pom.xml"), xml);
    await writeFile(path.join(root, "dotnet-app", "Example.csproj"), "<Project />");
    await writeFile(path.join(root, "node_modules", "ignored", "pom.xml"), "<project />");
    return { root, xml };
}

async function controller(t) {
    const { root, xml } = await fixture(t);
    const counts = { confirms: 0, policies: 0, sends: 0, executions: 0, reads: 0 };
    let approval = true;
    let policy = true;
    let confirmationAction = async () => {};
    const session = {
        sessionId: "improvement-session",
        capabilities: { ui: { elicitation: true } },
        on: () => () => {},
        ui: { confirm: async () => { counts.confirms++; await confirmationAction(); return approval; } },
        send: async () => { counts.sends++; throw new Error("No model calls allowed."); },
        rpc: {
            metadata: { snapshot: async () => ({ workingDirectory: root, workspacePath: root, isRemote: false }) },
            contentExclusion: { checkPaths: async ({ paths }) => {
                counts.policies++;
                return { available: policy, checks: policy ? paths.map(file => ({ path: file, excluded: false })) : [] };
            } },
            shell: { executeUserRequested: async () => { counts.executions++; throw new Error("No native execution allowed."); } },
        },
    };
    const workbench = new Workbench(session, path.join(root, "artifacts"), error => { throw error; });
    const readPreviewFile = workbench.readPreviewFile.bind(workbench);
    workbench.readPreviewFile = file => { counts.reads++; return readPreviewFile(file); };
    await workbench.initialize();
    t.after(() => workbench.close());
    const content = await readFile(new URL("./native-java-full.json", import.meta.url), "utf8");
    const imported = await workbench.importFiles({ files: [{ name: "report.json", content }] });
    return { root, xml, workbench, counts, assessmentId: imported.assessmentId, approve: value => { approval = value; }, policy: value => { policy = value; }, onConfirm: callback => { confirmationAction = callback; } };
}

async function link(env) {
    const discovery = await env.workbench.action("discover_apps", { relativePath: "." });
    const app = discovery.candidates.find(item => item.relativePath === "java-app");
    const saved = await env.workbench.action("save_review_context", { candidateId: app.id, goal: "Understand the app", notes: "Synthetic review context", revision: (await env.workbench.state()).revision });
    await env.workbench.action("link_current_source", { contextId: saved.contextId, assessmentId: env.assessmentId, revision: (await env.workbench.state()).revision });
    return saved.contextId;
}

test("metadata discovery finds both languages without vendor candidates and reports limits/policy", async t => {
    const { root } = await fixture(t);
    const found = await discoverApplications(root, ".", async () => true);
    assert.equal(found.partial, false);
    assert.deepEqual(new Set(found.candidates.map(item => item.language)), new Set(["java", "dotnet"]));
    assert.equal(found.candidates.some(item => item.relativePath.includes("node_modules")), false);
    const partial = await discoverApplications(root, ".", async () => true, { candidates: 1 });
    assert.equal(partial.partial, true);
    assert.equal(partial.candidates.length, 1);
    const excluded = await discoverApplications(root, ".", async () => false);
    assert.equal(excluded.candidates.length, 0);
    assert.equal(excluded.partial, true);
    await assert.rejects(discoverApplications(root, "..", async () => true), { code: "path_outside_scope" });
});

test("legacy review defaults and gap actions never manufacture checks or tool health", async () => {
    assert.deepEqual(reviewFields({}), { reviewContexts: [], sourceBindings: [], activeReviewContextId: null });
    assert.throws(() => reviewFields({ reviewContexts: "corrupt" }), { code: "invalid_store" });
    const assessment = normalizeAssessment([{ name: "report.json", content: await readFile(new URL("./native-java-full.json", import.meta.url), "utf8") }]);
    const before = JSON.stringify(assessment);
    const cards = coverageGaps(assessment, null, false);
    assert.ok(cards.some(item => item.reason === "facts_missing"));
    assert.ok(cards.some(item => item.reason === "source_unlinked"));
    assert.ok(cards.every(item => item.actions.every(action => ["import_folder", "start", "draft_question", "prepare_full"].includes(action.kind))));
    assert.equal(JSON.stringify(assessment), before);
    const readiness = readinessCards({ approvals: true, nativeRuns: true });
    assert.equal(readiness.find(item => item.id === "java").status, "not_rechecked");
    assert.ok(readiness.every(item => item.observedAt === null));
});

test("review context and explicit source links preserve native identity and reject stale edits", async t => {
    const env = await controller(t);
    const original = (await env.workbench.state()).assessments[0];
    const revision = (await env.workbench.state()).revision;
    const contextId = await link(env);
    const state = await env.workbench.state();
    assert.equal(state.activeReviewContextId, contextId);
    assert.equal(state.sourceBindings[0].provenance, "user-linked-current");
    assert.equal(state.assessments[0].sourceStatus, "unverified import");
    assert.equal(state.assessments[0].contentDigest, original.contentDigest);
    assert.deepEqual(state.assessments[0].findings, original.findings);
    await assert.rejects(env.workbench.action("save_review_context", { candidateId: state.reviewContexts[0].app.id, goal: "Understand the app", notes: "", revision }), { code: "stale_revision" });
    assert.equal(env.counts.sends + env.counts.executions + env.counts.confirms, 0);
});

test("current previews require approval, remain unverified, and never enter general state", async t => {
    const env = await controller(t);
    await link(env);
    let state = await env.workbench.state();
    const ref = state.assessments[0].evidence.find(item => item.sourcePath);
    const request = { assessmentId: env.assessmentId, evidenceId: ref.id, mode: "current", revision: state.revision };
    env.approve(false);
    const declined = await env.workbench.action("request_source_preview", request);
    assert.equal(declined.status, "approval_declined");
    assert.deepEqual(declined.lines, []);
    assert.equal(env.counts.reads, 0);
    env.approve(true);
    const preview = await env.workbench.action("request_source_preview", request);
    assert.equal(preview.kind, "current_unverified");
    assert.equal(preview.status, "ready");
    assert.equal(env.counts.reads, 1);
    assert.ok(preview.lines.some(item => item.highlighted && item.number === ref.line));
    state = await env.workbench.state();
    assert.equal(JSON.stringify(state).includes("synthetic line"), false);
    assert.equal(state.assessments[0].sourceStatus, "unverified import");
    env.policy(false);
    const confirmations = env.counts.confirms;
    await assert.rejects(env.workbench.action("request_source_preview", request), { code: "content_excluded" });
    assert.equal(env.counts.confirms, confirmations);
    assert.equal(env.counts.reads, 1);
    assert.equal(env.counts.sends + env.counts.executions, 0);
});

test("owned snapshot previews verify bytes; mismatch or foreign ownership cannot fall back to current", async t => {
    const env = await controller(t);
    const runRoot = path.join(env.root, "files", "modernization-workbench", "runs", "job-synthetic");
    await mkdir(path.join(runRoot, "source"), { recursive: true });
    await writeFile(path.join(runRoot, "source", "pom.xml"), env.xml);
    await env.workbench.systemUpdate(data => {
        data.assessments[0].source = { root: path.join(env.root, "java-app"), runRoot, files: [{ path: "pom.xml", digest: digest(env.xml) }] };
        data.assessments[0].sourceStatus = "snapshot";
        data.jobs.push({ id: "job-synthetic", assessmentId: env.assessmentId, runRoot, ownerSessionId: "improvement-session", status: "completed" });
        return data;
    });
    const state = await env.workbench.state();
    const ref = state.assessments[0].evidence.find(item => item.sourcePath);
    const request = { assessmentId: env.assessmentId, evidenceId: ref.id, mode: "snapshot", revision: state.revision };
    const preview = await env.workbench.action("request_source_preview", request);
    assert.equal(preview.kind, "snapshot_matched");
    assert.equal(env.counts.confirms, 0);
    await writeFile(path.join(runRoot, "source", "pom.xml"), "changed snapshot");
    await assert.rejects(env.workbench.action("request_source_preview", request), { code: "snapshot_changed" });
    await env.workbench.systemUpdate(data => { data.jobs[0].ownerSessionId = "another-session"; return data; });
    const foreign = await env.workbench.action("request_source_preview", { ...request, revision: (await env.workbench.state()).revision });
    assert.equal(foreign.status, "snapshot_unavailable");
});

test("source excerpts bound line and byte output without fabricating a reported location", () => {
    const content = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join("\r\n");
    const preview = sourceExcerpt(content, 90);
    assert.equal(preview.lines.length, 120);
    assert.equal(preview.truncated, true);
    assert.equal(sourceExcerpt(content, 0).status, "line_unavailable");
    assert.equal(sourceExcerpt(content, 900).status, "line_unavailable");
    assert.equal(sourceExcerpt(content, 900, true).navigation, true);
    assert.equal(sourceExcerpt("x".repeat(32769), 1).status, "excerpt_limit");
    assert.throws(() => decodeSource(Buffer.from([0xfe, 0xff, 0x01])), { code: "source_encoding" });
});

test("ambiguous source references require a mapping and stay unverified after current-file approval", async t => {
    const env = await controller(t);
    const native = JSON.parse(await readFile(new URL("./native-java-full.json", import.meta.url), "utf8"));
    native.projects[0].path = "module";
    env.assessmentId = (await env.workbench.importFiles({ files: [{ name: "report.json", content: JSON.stringify(native) }] })).assessmentId;
    await link(env);
    const state = await env.workbench.state();
    const ref = state.assessments.find(item => item.id === env.assessmentId).evidence.find(item => item.sourcePath);
    const request = { assessmentId: env.assessmentId, evidenceId: ref.id, mode: "current", revision: state.revision };
    const ambiguous = await env.workbench.action("request_source_preview", request);
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.candidates.length, 2);
    assert.equal(env.counts.reads + env.counts.confirms, 0);
    const mapped = await env.workbench.action("request_source_preview", { ...request, relativeFile: path.join("module", "pom.xml") });
    assert.equal(mapped.kind, "current_unverified");
    assert.equal(mapped.mapping, "user-selected mapping");
});

test("legacy source metadata is recovered only from the matching immutable native bundle", async t => {
    const env = await controller(t);
    await link(env);
    await env.workbench.systemUpdate(data => {
        for (const ref of data.assessments[0].evidence) delete ref.projectPath;
        return data;
    });
    const state = await env.workbench.state();
    const ref = state.assessments[0].evidence.find(item => item.sourcePath);
    const request = { assessmentId: env.assessmentId, evidenceId: ref.id, mode: "current", revision: state.revision };
    assert.equal((await env.workbench.action("request_source_preview", request)).status, "ready");
    const bundlePath = path.join(env.root, "artifacts", "native", env.assessmentId, "bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    bundle[0].content += "\n";
    await writeFile(bundlePath, JSON.stringify(bundle));
    const reads = env.counts.reads;
    await assert.rejects(env.workbench.action("request_source_preview", request), { code: "bundle_changed" });
    assert.equal(env.counts.reads, reads);
});

test("missing, changed-during-approval, absolute, and escaping-link sources do not leak previews", async t => {
    const env = await controller(t);
    await link(env);
    let state = await env.workbench.state();
    const ref = state.assessments[0].evidence.find(item => item.sourcePath);
    const request = { assessmentId: env.assessmentId, evidenceId: ref.id, mode: "current", revision: state.revision };
    env.onConfirm(async () => writeFile(path.join(env.root, "java-app", "pom.xml"), "changed"));
    await assert.rejects(env.workbench.action("request_source_preview", request), { code: "file_changed" });
    assert.equal(env.counts.reads, 0);
    env.onConfirm(async () => {});
    await unlink(path.join(env.root, "java-app", "pom.xml"));
    assert.equal((await env.workbench.action("request_source_preview", request)).status, "missing");
    await mkdir(path.join(env.root, "outside-app"));
    await writeFile(path.join(env.root, "outside-app", "Other.java"), "class Other {}");
    await symlink(path.join(env.root, "outside-app"), path.join(env.root, "java-app", "escape"), "junction");
    await env.workbench.systemUpdate(data => {
        data.assessments[0].evidence.find(item => item.id === ref.id).sourcePath = path.join("escape", "Other.java");
        return data;
    });
    state = await env.workbench.state();
    await assert.rejects(env.workbench.action("request_source_preview", { ...request, revision: state.revision }), { code: "path_outside_scope" });
    assert.equal(env.counts.reads, 0);
    await env.workbench.systemUpdate(data => {
        data.assessments[0].evidence.find(item => item.id === ref.id).sourcePath = "C:\\outside\\Other.java";
        return data;
    });
    await assert.rejects(env.workbench.action("request_source_preview", { ...request, revision: (await env.workbench.state()).revision }), { code: "path_outside_scope" });
    assert.equal(env.counts.reads, 0);
});

test("passive state reads and fact imports do not grant source access or promote unknown coverage", async t => {
    const env = await controller(t);
    const prior = await env.workbench.state();
    const policyCalls = env.counts.policies;
    await env.workbench.state();
    assert.equal(env.counts.policies, policyCalls);
    const native = await readFile(new URL("./native-java-full.json", import.meta.url), "utf8");
    await env.workbench.importFiles({ files: [{ name: "report.json", content: native }, { name: "facts/architecture.md", content: "# Synthetic narrative\nNeeds evidence review." }] });
    const after = await env.workbench.state();
    assert.deepEqual(after.assessments[0], prior.assessments[0]);
    assert.equal(after.assessments[1].insights.length, 1);
    assert.equal(after.assessments[1].coverage.find(item => item.name === "Architecture").state, "unknown");
    assert.equal(env.counts.confirms + env.counts.reads + env.counts.sends + env.counts.executions, 0);
});
