import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { digest, fail, newId, object, parseJson, text } from "./common.mjs";

const schema = JSON.parse(await readFile(new URL("./schemas/native-report.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const insightNames = ["Architecture", "API contracts", "Configuration", "Business workflows", "Dependencies", "Data model"];

function label(labels, key) {
    return labels?.find(item => item.startsWith(`${key}=`))?.slice(key.length + 1);
}

export function validateBundle(input) {
    object(input, ["files"]);
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 128) fail("invalid_bundle", "Select between 1 and 128 report files.");
    let total = 0;
    const seen = new Set();
    return input.files.map(item => {
        object(item, ["name", "content"]);
        const name = text(item.name, "Report filename", 1024).replaceAll("\\", "/");
        if (name.startsWith("/") || name.includes(":") || name.split("/").some(part => part === ".." || part === "")) {
            fail("invalid_bundle", "Report filenames must be safe relative names.");
        }
        if (seen.has(name)) fail("invalid_bundle", "The bundle contains duplicate filenames.");
        seen.add(name);
        if (!/\.(json|md|html)$/i.test(name)) fail("invalid_bundle", "Only JSON, Markdown, and HTML report documents are supported.");
        if (typeof item.content !== "string") fail("invalid_bundle", "Report content must be UTF-8 text.");
        const size = Buffer.byteLength(item.content);
        total += size;
        if (size > 25 * 1024 * 1024 || total > 30 * 1024 * 1024) fail("payload_limit", "Report bundle exceeds the 25 MiB/file or 30 MiB total limit.", 413);
        return { name, content: item.content };
    });
}

export function normalizeAssessment(files, source = null) {
    const jsonFiles = files.filter(file => /(^|\/)(report|aggregate-report)\.json$/i.test(file.name));
    const perRepo = jsonFiles.filter(file => /(^|\/)report\.json$/i.test(file.name));
    const candidates = perRepo.length ? perRepo : jsonFiles;
    if (candidates.length !== 1) fail("ambiguous_report", "Select one application's report.json and optional facts, not a portfolio of reports.");
    const file = candidates[0];
    const report = parseJson(Buffer.from(file.content), "Native report");
    if (!validate(report)) {
        const locations = validate.errors.map(error => `${error.instancePath || "/"} ${error.keyword}`).join("; ");
        fail("unsupported_report", `Unsupported or invalid native report contract: ${locations}. Original documents were not treated as structured findings.`);
    }
    if (report.projects.length > 1000 || report.projects.reduce((count, project) => count + project.incidents.length, 0) > 20000) {
        fail("payload_limit", "The report exceeds 1,000 projects or 20,000 finding locations. Select a smaller application report.", 413);
    }
    const languages = new Set(report.projects.flatMap(project => Array.isArray(project.properties.languages) ? project.properties.languages : []));
    const isJava = report.producer === "Java AppCAT CLI" || languages.has("Java");
    if (!isJava) fail("unsupported_report", "The .NET native producer contract has not yet been verified.");
    const assessment = {
        id: newId("assessment"),
        name: report.projects[0]?.properties.appName || "Assessed application",
        language: "Java",
        toolVersion: `${report.producer} / schema ${report.version}`,
        importedAt: new Date().toISOString(),
        contentDigest: digest(files.slice().sort((a, b) => a.name.localeCompare(b.name))),
        sourceStatus: source ? (source.stale ? "stale snapshot" : "snapshot") : "unverified import",
        sourceLabel: source?.relativePath ?? "Imported report; current source has not been reconciled",
        source,
        coverage: [],
        components: [],
        relationships: [],
        findings: [],
        insights: [],
        evidence: [],
        warnings: [],
        nativeSummary: report.summary ?? null,
        nativeStatus: report.metadata.status,
        nativeMode: report.metadata.mode ?? "unknown",
        nativeTargets: report.metadata.targetIds ?? [],
    };
    const evidence = (title, locator, value, sourcePath, line, projectPath) => {
        const id = `evidence-${digest(`${file.name}:${locator}`).slice(0, 24)}`;
        assessment.evidence.push({
            id, title, artifact: file.name, locator,
            text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
            ...(sourcePath ? { sourcePath } : {}), ...(Number.isInteger(line) ? { line } : {}),
            ...(typeof projectPath === "string" ? { projectPath } : {}),
        });
        return id;
    };
    let expandedBytes = 0;
    const ruleSizes = new Map(Object.entries(report.rules).map(([id, rule]) => [id, Buffer.byteLength(JSON.stringify(rule))]));
    const projectPaths = new Set();
    for (const [projectIndex, project] of report.projects.entries()) {
        if (projectPaths.has(project.path)) fail("ambiguous_project", "Native project paths are duplicated; source relationships are ambiguous.");
        projectPaths.add(project.path);
        const projectId = `component-${digest(`project:${project.path}`).slice(0, 24)}`;
        const projectEvidence = evidence("Reported project inventory", `#/projects/${projectIndex}/properties`, project.properties);
        assessment.components.push({
            id: projectId, name: project.properties.appName || project.path, kind: "Project",
            detail: JSON.stringify(project.properties, null, 2), evidenceIds: [projectEvidence],
        });
        for (const [index, incident] of project.incidents.entries()) {
            const rule = Object.hasOwn(report.rules, incident.ruleId) ? report.rules[incident.ruleId] : undefined;
            if (!rule) fail("invalid_native_reference", `Incident references an absent rule: ${incident.ruleId}.`);
            expandedBytes += ruleSizes.get(incident.ruleId) * 4 + Buffer.byteLength(JSON.stringify(incident)) + 4096;
            if (expandedBytes > 64 * 1024 * 1024) fail("payload_limit", "Expanded evidence exceeds the 64 MiB normalization budget. No partial assessment was imported.", 413);
            const locator = `#/projects/${projectIndex}/incidents/${index}`;
            const incidentEvidence = evidence(rule.title, locator, { incident, rule }, incident.location, incident.line, project.path);
            const componentIds = [projectId];
            if (incident.location) {
                const fileId = `component-${digest(`file:${project.path}:${incident.location}`).slice(0, 24)}`;
                let component = assessment.components.find(item => item.id === fileId);
                if (!component) {
                    component = { id: fileId, name: incident.location, kind: "Source reference", detail: "Referenced by native findings; not a runtime dependency.", evidenceIds: [] };
                    assessment.components.push(component);
                    assessment.relationships.push({ id: `relationship-${fileId}`, source: projectId, target: fileId, label: "reported source", evidenceIds: [incidentEvidence] });
                }
                component.evidenceIds.push(incidentEvidence);
                componentIds.push(fileId);
            }
            if (assessment.components.length > 5000) fail("payload_limit", "The report exceeds 5,000 distinct components. Select a smaller application report.", 413);
            const nativeSeverity = rule.severity || "unknown";
            const priorityNames = ["mandatory", "potential", "optional", "information"];
            const targets = Object.keys(incident.targets ?? {}).sort();
            const fingerprint = digest([project.path, incident.ruleId, incident.location ?? "", incident.line ?? null, incident.column ?? null, targets]);
            assessment.findings.push({
                id: `finding-${digest(`${locator}:${fingerprint}`).slice(0, 24)}`,
                nativeId: incident.incidentId ?? null,
                title: rule.title, description: rule.description,
                category: label(rule.labels, "category") || label(rule.labels, "domain") || "Uncategorized",
                severity: priorityNames.includes(nativeSeverity.toLowerCase()) ? "Not reported" : nativeSeverity,
                priority: priorityNames.includes(nativeSeverity.toLowerCase()) ? nativeSeverity : "Not reported",
                recommendation: rule.description,
                componentIds, evidenceIds: [incidentEvidence], fingerprint, targets,
            });
        }
    }
    const domains = report.metadata.domains ?? [];
    for (const [name, domain] of [["Runtime/framework upgrade", "java-upgrade"], ["Cloud readiness", "cloud-readiness"], ["Security", "security"]]) {
        const reported = domains.includes(domain);
        assessment.coverage.push({ name, state: reported ? "reported" : "not_assessed", detail: reported ? `Native domain: ${domain}` : "This report does not declare this assessment domain." });
    }
    const facts = files.filter(item => /(^|\/)facts\/.+\.md$/i.test(item.name) && item.content.trim());
    for (const fact of facts) {
        const id = `evidence-${digest(fact.name).slice(0, 24)}`;
        assessment.evidence.push({ id, title: path.posix.basename(fact.name), artifact: fact.name, locator: "document", text: fact.content });
        assessment.insights.push({
            id: `insight-${digest(fact.name).slice(0, 24)}`, title: path.posix.basename(fact.name, ".md").replaceAll("-", " "),
            body: fact.content, method: "Native narrative; static analysis, not observed runtime behavior", evidenceIds: [id],
        });
    }
    for (const name of insightNames) {
        assessment.coverage.push({
            name, state: "unknown",
            detail: facts.length ? "Narrative facts are available; this specific insight needs evidence review." : `No native fact document was supplied, even though the report mode is ${assessment.nativeMode}.`,
        });
    }
    if (!facts.length) assessment.warnings.push("This native report contains findings and project inventory but no codebase fact documents. Full mode alone is not proof that architecture or workflow analysis completed.");
    if (report.metadata.status !== "Complete") assessment.warnings.push(`Native assessment status: ${report.metadata.status}. Findings may be incomplete.`);
    if (!source) assessment.warnings.push("Imported evidence is not bound to the current working tree. A source-bound execution handoff requires a verified assessment run.");
    return assessment;
}
