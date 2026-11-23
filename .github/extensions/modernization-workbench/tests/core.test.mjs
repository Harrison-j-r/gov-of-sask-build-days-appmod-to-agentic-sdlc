import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scopedPath, parseJson, readLimited, object } from "../common.mjs";
import { ArtifactStore, repositoryKey, replaceFile } from "../store.mjs";
import { CopilotBridge } from "../copilot-bridge.mjs";
import { startServer } from "../server.mjs";
import { normalizeAssessment, validateBundle } from "../assessment.mjs";
import { workerArguments } from "../runner.mjs";
import { prepareHandoff, assertHandoffCurrent } from "../handoff.mjs";
import { collectSource, stageSource, unchanged } from "../source.mjs";

async function temporary(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "modernization-workbench-test-"));
    t.after(() => rm(root, { recursive: true }));
    return root;
}

test("decisions persist across independent stores and stale edits cannot overwrite them", async t => {
    const root = await temporary(t);
    const first = new ArtifactStore(root);
    const second = new ArtifactStore(root);
    await first.create("assessment-example", { decisions: [] });
    await second.update("assessment-example", 1, data => ({ ...data, decisions: ["include"] }));
    await assert.rejects(first.update("assessment-example", 1, () => ({ decisions: ["exclude"] })), { code: "stale_revision" });
    assert.deepEqual((await new ArtifactStore(root).read("assessment-example")).data.decisions, ["include"]);
});

test("simultaneous independent writers cannot both commit against the same revision", async t => {
    const root = await temporary(t);
    const first = new ArtifactStore(root);
    await first.create("assessment-example", { decision: null });
    const results = await Promise.allSettled([
        first.update("assessment-example", 1, () => ({ decision: "include" })),
        new ArtifactStore(root).update("assessment-example", 1, () => ({ decision: "defer" })),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await first.read("assessment-example")).revision, 2);
});

test("Windows atomic replacement retries sharing violations but never hides permanent failure", async () => {
    let calls = 0;
    await replaceFile("temporary", "record", {
        platform: "win32",
        wait: async () => {},
        renameFile: async () => {
            calls++;
            if (calls < 3) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
        },
    });
    assert.equal(calls, 3);
    await assert.rejects(replaceFile("temporary", "record", {
        platform: "win32",
        wait: async () => {},
        renameFile: async () => { throw Object.assign(new Error("permanent failure"), { code: "EPERM" }); },
    }), { code: "EPERM" });
    await assert.rejects(replaceFile("temporary", "record", {
        platform: "win32",
        wait: async () => { assert.fail("Non-sharing failures must not be retried."); },
        renameFile: async () => { throw Object.assign(new Error("missing source"), { code: "ENOENT" }); },
    }), { code: "ENOENT" });
});

test("failed mutations and malformed artifacts do not reset data", async t => {
    const root = await temporary(t);
    const store = new ArtifactStore(root);
    await store.create("assessment-example", { preserved: true });
    await assert.rejects(store.update("assessment-example", 1, () => { throw new Error("injected"); }), /injected/);
    assert.deepEqual((await store.read("assessment-example")).data, { preserved: true });
    await writeFile(store.file("assessment-example"), "{corrupt");
    await assert.rejects(store.read("assessment-example"), { code: "invalid_json" });
    assert.equal(await readFile(store.file("assessment-example"), "utf8"), "{corrupt");
});

test("path traversal, oversized input, and unexpected fields are rejected", async t => {
    const root = await temporary(t);
    await writeFile(path.join(root, "report.json"), '{"a":1}');
    await assert.rejects(scopedPath(root, "..\\outside.json"), { code: "path_outside_scope" });
    await assert.rejects(readLimited(path.join(root, "report.json"), 6), { code: "payload_limit" });
    assert.deepEqual(parseJson(await readLimited(path.join(root, "report.json"), 7), "Report"), { a: 1 });
    assert.throws(() => object({ executable: "unexpected" }, ["id"]), { code: "invalid_input" });
    assert.notEqual(repositoryKey(path.join(root, "clone-a")), repositoryKey(path.join(root, "clone-b")));
});

test("source exclusion fails closed and snapshot freshness includes newly added files", async t => {
    const root = await temporary(t);
    const app = path.join(root, "app");
    await mkdir(app);
    await writeFile(path.join(app, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");
    await assert.rejects(collectSource(root, "app", "java", async () => false), { code: "content_excluded" });
    const source = await collectSource(root, "app", "java", async () => true);
    assert.equal(await unchanged(source), true);
    await stageSource(source, path.join(root, "staged"));
    await writeFile(path.join(app, "New.java"), "class New {}");
    assert.equal(await unchanged(source), false);
    assert.equal(await readFile(path.join(root, "staged", "pom.xml"), "utf8"), source.files[0].content);
});

test("staging preserves UTF-16 source bytes while inspecting their decoded text", async t => {
    const root = await temporary(t);
    await mkdir(path.join(root, "app"));
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<project><modelVersion>4.0.0</modelVersion></project>", "utf16le")]);
    await writeFile(path.join(root, "app", "pom.xml"), bytes);
    const source = await collectSource(root, "app", "java", async () => true);
    await stageSource(source, path.join(root, "staged"));
    assert.deepEqual(await readFile(path.join(root, "staged", "pom.xml")), bytes);
    assert.equal(await unchanged(source), true);
});

test("chat correlates native origins and never copies unrelated messages or reasoning", async () => {
    let listener;
    const received = [];
    const session = {
        sessionId: "owner",
        on: (name, handler) => { listener = handler; return () => {}; },
        send: async () => "native-question",
        capabilities: { ui: { elicitation: false } },
    };
    const bridge = new CopilotBridge(session, { received: (id, message) => received.push({ id, message }), failed: assert.fail });
    await bridge.submit("thread-example", "Explain this finding.", { assessmentId: "assessment-example" });
    listener({ data: { originatingMessageId: "unrelated", messageId: "wrong", content: "Unrelated private response." } });
    listener({ data: { originatingMessageId: "unrelated", clientRequestId: "thread-example", messageId: "stale-header", content: "Must not attach through an old request header." } });
    listener({ data: { originatingMessageId: "native-question", messageId: "hidden", phase: "analysis", content: "Not ordinary response content." } });
    listener({ data: { originatingMessageId: "native-question", messageId: "answer", content: "Evidence-linked answer.", reasoningText: "Must not appear." } });
    listener({ data: { originatingMessageId: "native-question", messageId: "answer", content: "Duplicate." } });
    assert.deepEqual(received, [{
        id: "thread-example",
        message: { messageId: "answer", originatingMessageId: "native-question", content: "Evidence-linked answer." },
    }]);
    await assert.rejects(bridge.confirm("Run?"), { code: "approval_unavailable" });
    bridge.close();
});

test("chat buffers an admission race but verifies the returned native origin before delivery", async () => {
    let listener;
    const received = [];
    const session = {
        on: (_name, handler) => { listener = handler; return () => {}; },
        send: async () => {
            listener({ data: { originatingMessageId: "other-origin", clientRequestId: "thread-race", messageId: "wrong", content: "Wrong origin." } });
            listener({ data: { originatingMessageId: "admitted-origin", clientRequestId: "thread-race", messageId: "correct", content: "Correct origin." } });
            return "admitted-origin";
        },
    };
    const bridge = new CopilotBridge(session, { received: (_id, response) => received.push(response), failed: assert.fail });
    await bridge.submit("thread-race", "Explain.", {});
    assert.equal(received.length, 1);
    assert.equal(received[0].messageId, "correct");
    await assert.rejects(bridge.submit("thread-race", "Again.", {}), { code: "duplicate_request" });
    bridge.close();
});

test("loopback transport requires authorization and rejects foreign origins and executable input", async t => {
    const root = await temporary(t);
    await writeFile(path.join(root, "index.html"), '<meta name="workbench-token" content="__WORKBENCH_TOKEN__">');
    let calls = 0;
    const server = await startServer({
        publicRoot: root,
        state: async () => ({ revision: 1 }),
        action: async () => { calls++; return {}; },
        evidence: async () => ({}),
        subscribe: () => () => {},
        log: assert.fail,
    });

    t.after(() => server.close());
    const html = await (await fetch(server.url)).text();
    const token = /content="([^"]+)"/.exec(html)[1];
    assert.equal((await fetch(`${server.url}api/state`)).status, 403);
    const headers = { Authorization: `Bearer ${token}`, Origin: new URL(server.url).origin, "Content-Type": "application/json" };
    assert.deepEqual(await (await fetch(`${server.url}api/state`, { headers })).json(), { revision: 1 });
    assert.equal((await fetch(`${server.url}api/action`, { method: "POST", headers: { ...headers, Origin: "https://foreign.invalid" }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${server.url}api/action`, { method: "POST", headers, body: '{"name":"test","input":{},"command":"forbidden"}' })).status, 400);
    assert.equal(calls, 0);
});

test("genuine native report preserves incident totals, priorities, and missing Full-analysis facts", async () => {
        const content = await readFile(new URL("./native-java-full.json", import.meta.url), "utf8");
        const native = JSON.parse(content);
        const assessment = normalizeAssessment(validateBundle({ files: [{ name: "report.json", content }] }));
        assert.equal(assessment.findings.length, native.summary.totalIncidents);
        assert.equal(assessment.findings.filter(item => item.priority === "mandatory").length, native.summary.charts.severity.mandatory);
        assert.ok(assessment.findings.every(item => item.severity === "Not reported"));
        assert.equal(assessment.nativeMode, "full");
        assert.equal(assessment.coverage.find(item => item.name === "Architecture").state, "unknown");
        assert.equal(assessment.coverage.find(item => item.name === "Security").state, "not_assessed");
        assert.ok(assessment.findings.every(item => item.evidenceIds.every(id => assessment.evidence.some(ref => ref.id === id))));
        assert.equal(assessment.sourceStatus, "unverified import");
    });

    test("native issue-only reports import without guessing facts, and invalid versions fail", async () => {
        const content = await readFile(new URL("./native-java-issues.json", import.meta.url), "utf8");
        const assessment = normalizeAssessment([{ name: "report.json", content }]);
        assert.equal(assessment.findings.length, 3);
        assert.equal(assessment.insights.length, 0);
        const invalid = JSON.parse(content);
        invalid.version = "99.0";
        assert.throws(() => normalizeAssessment([{ name: "report.json", content: JSON.stringify(invalid) }]), { code: "unsupported_report" });
        assert.throws(() => validateBundle({ files: [{ name: "../report.json", content }] }), { code: "invalid_bundle" });
        const missingRule = JSON.parse(content);
        delete missingRule.rules["dockerfile-00000"];
        assert.throws(() => normalizeAssessment([{ name: "report.json", content: JSON.stringify(missingRule) }]), { code: "invalid_native_reference" });
        const inheritedName = JSON.parse(content);
        inheritedName.projects[0].incidents[0].ruleId = "constructor";
        assert.throws(() => normalizeAssessment([{ name: "report.json", content: JSON.stringify(inheritedName) }]), { code: "invalid_native_reference" });
    });

    test("runner profiles reject executable injection and never offer upgrade or execute", () => {
        const root = path.resolve("synthetic-job");
        const args = workerArguments({ id: "job-example", kind: "assess", language: "java", mode: "full" }, root);
        assert.equal(args[0], "assess");
        assert.ok(args.includes("--no-tty"));
        assert.ok(args.includes(path.join(root, "source")));
        assert.throws(() => workerArguments({ id: "job-example", kind: "upgrade", language: "java", mode: "full" }, root), { code: "invalid_job" });
        assert.throws(() => workerArguments({ id: "job-example", kind: "assess", language: "java", mode: "full", executable: "unexpected" }, root), { code: "invalid_input" });
    });

test("compact native input cannot expand into unbounded duplicated evidence", async () => {
    const report = JSON.parse(await readFile(new URL("./native-java-full.json", import.meta.url), "utf8"));
    report.rules["azure-java-version-02000"].description = "Large reported explanation. ".repeat(2500);
    report.projects[0].incidents = Array.from({ length: 1000 }, (_, index) => ({ ...report.projects[0].incidents[0], incidentId: `large-${index}` }));
    assert.throws(() => normalizeAssessment([{ name: "report.json", content: JSON.stringify(report) }]), { code: "payload_limit" });
});

    test("review packets are traceable and become stale when decisions change", async () => {
        const content = await readFile(new URL("./native-java-full.json", import.meta.url), "utf8");
        const assessment = normalizeAssessment([{ name: "report.json", content }]);
        const decisions = [{ assessmentId: assessment.id, findingId: assessment.findings[0].id, state: "include", rationale: "Preserve the search behavior while reviewing the runtime target." }];
        const packet = prepareHandoff(assessment, decisions, "Upgrade in place", "No deployment. Verify search results.");
        assert.match(packet.body, /Review request only/);
        assert.ok(packet.body.includes(assessment.findings[0].evidenceIds[0]));
        assertHandoffCurrent(packet, assessment, decisions);
        assert.throws(() => assertHandoffCurrent(packet, assessment, [{ ...decisions[0], state: "defer" }]), { code: "empty_scope" });
        assert.throws(() => assertHandoffCurrent({ ...packet, body: "changed" }, assessment, decisions), { code: "stale_handoff" });
    });
