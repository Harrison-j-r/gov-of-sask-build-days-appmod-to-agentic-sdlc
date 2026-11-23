import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadGuide, readSource, sections } from "../guide.mjs";
import { createProgressStore, repositoryKey } from "../progress.mjs";
import { startServer } from "../server.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const guide = await loadGuide(root);
const key = createHash("sha256").update("synthetic-workshop-checkout").digest("hex");

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), "lab-journey-test-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    return { base, store: createProgressStore(key, guide, base) };
}

test("all eight labs resolve for each track; source blocks remain exact", async () => {
    for (const track of ["java", "dotnet"]) {
        const labs = guide.tracks[track];
        assert.deepEqual(labs.map((lab) => lab.id), ["00", "01", "02", "03", "04", "05", "06", "07"]);
        for (const lab of labs) {
            assert.ok(lab.steps.length > 0);
            assert.equal(new Set(lab.steps.map((step) => step.id)).size, lab.steps.length);
            for (const step of lab.steps) {
                const source = await readSource(root, step.source);
                assert.ok(sections(source).some((section) => section.title === step.title));
                const blocks = [...step.body.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)];
                for (const [, body] of blocks) assert.ok(source.replace(/\r\n/g, "\n").includes(body), `${step.id}: exact source block`);
            }
        }
        assert.ok(labs[4].steps.every((step) => step.source.includes(`/${track}/`) || step.source === labs[4].source));
        const readiness = labs[0].steps.find((step) => step.title === "3. Run your track check");
        assert.ok(readiness.body.includes(`check-${track}`));
        assert.ok(!readiness.body.includes(`check-${track === "java" ? "dotnet" : "java"}`));
    }
    assert.ok(guide.safety.some((rule) => rule.includes("ResponseInputStream")));
    assert.ok(guide.safety.some((rule) => rule.includes("v0.89.21")));
});

test("updated Day 1 rationale, lab introductions, and shared AppMod framework stay source-backed", async () => {
    const readme = await readSource(root, "README.md");
    assert.ok(readme.replace(/\r\n/g, "\n").includes(guide.orientation.body));
    assert.match(guide.orientation.body, /Day 2/);
    for (const track of ["java", "dotnet"]) {
        for (const lab of guide.tracks[track]) {
            const source = await readSource(root, lab.source);
            assert.ok(source.replace(/\r\n/g, "\n").includes(lab.intro));
            assert.match(lab.intro, /Why this lab/);
            assert.match(lab.intro, /Time/);
        }
        const framework = guide.tracks[track][4].steps.find((step) => step.title === "The three-step framework in this workshop");
        assert.equal(framework.source, "labs/04-app-modernization/README.md");
        assert.match(framework.body, /Code preparation/);
        assert.match(framework.body, /Enrichment/);
        assert.match(framework.body, /Automation aids/);
    }
});

test("existing track progress survives adding shared modernization context", async (t) => {
    const { base } = await fixture(t);
    const previous = structuredClone(guide);
    for (const track of ["java", "dotnet"]) {
        previous.tracks[track][4].steps = previous.tracks[track][4].steps.filter((step) => step.source !== previous.tracks[track][4].source);
    }
    const oldStore = createProgressStore(key, previous, base);
    const step = previous.tracks.java[4].steps[0].id;
    let state = await oldStore.update({ revision: 0, kind: "select", lab: "04", step });
    state = await oldStore.update({ revision: state.revision, kind: "step", step, status: "done" });
    assert.deepEqual(await createProgressStore(key, guide, base).read(), state);
});

test("fenced examples do not become headings or empty steps", () => {
    const parsed = sections("## One\n```markdown\n## Fake\n```\n### Child\nBody\n## Two\nNext");
    assert.deepEqual(parsed.map((section) => section.title), ["One", "Child", "Two"]);
    assert.ok(parsed[0].body.includes("## Fake"));
});

test("repository distribution includes all assets and a safe documented README launcher", async () => {
    const extension = new URL("../", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("copilot-extension.json", extension), "utf8"));
    assert.deepEqual(manifest, { name: "lab-journey", version: 1 });
    for (const file of ["extension.mjs", "guide.mjs", "progress.mjs", "server.mjs", "index.html", "app.js", "style.css"]) {
        assert.ok((await readFile(new URL(file, extension), "utf8")).length > 0, `Included asset: ${file}`);
    }
    const readme = await readSource(root, "README.md");
    const href = /\[.*Open the lab guide in GitHub Copilot.*\]\((https:\/\/github\.com\/copilot\/app\/launch[^)]+)\)/.exec(readme)?.[1];
    assert.ok(href, "Prominent README launcher");
    const app = new URL(new URL(href).searchParams.get("open"));
    assert.equal(app.protocol, "ghapp:");
    assert.equal(app.host, "session");
    assert.equal(app.pathname, "/new");
    assert.equal(app.searchParams.get("repo"), "VeVarunSharma/gov-of-sask-build-days-appmod-to-agentic-sdlc");
    assert.equal(app.searchParams.get("mode"), "interactive");
    assert.equal(app.searchParams.get("prompt"), "Open the Build Day lab guide canvas. Do not run any lab commands.");
    assert.deepEqual([...app.searchParams.keys()].sort(), ["mode", "prompt", "repo"]);
    assert.ok(!href.includes("127.0.0.1"));
    const setup = await readFile(new URL("README.md", extension), "utf8");
    assert.match(setup, /project scope/);
    assert.match(setup, /Installing only this folder into an unrelated/);
});

test("source access refuses traversal, arbitrary files, and facilitator solutions", async () => {
    for (const source of ["../README.md", ".github/copilot-instructions.md", "facilitator/reference-solutions/copilot/README.md", null]) {
        await assert.rejects(readSource(root, source), { code: "source_not_allowed" });
    }
});

test("worktrees share stable repository identity without using their branch names", async (t) => {
    const { base } = await fixture(t);
    for (const name of ["one", "two"]) {
        await mkdir(join(base, name));
        await writeFile(join(base, name, ".git"), `gitdir: ${join(base, "common", ".git", "worktrees", name)}\n`);
    }
    assert.equal(await repositoryKey(join(base, "one")), await repositoryKey(join(base, "two")));
    await mkdir(join(base, "fork"));
    await mkdir(join(base, "fork", ".git"));
    assert.notEqual(await repositoryKey(join(base, "one")), await repositoryKey(join(base, "fork")));
});

test("progress survives a fresh store and is isolated by track and repository", async (t) => {
    const { base, store } = await fixture(t);
    const step = guide.tracks.java[0].steps[0].id;
    let state = await store.update({ revision: 0, kind: "step", step, status: "done" });
    assert.equal(state.tracks.java.progress[step].status, "done");
    const reopened = createProgressStore(key, guide, base);
    assert.deepEqual(await reopened.read(), state);
    state = await reopened.update({ revision: state.revision, kind: "select", track: "dotnet" });
    assert.deepEqual(state.tracks.dotnet.progress, {});
    assert.equal(state.tracks.java.progress[step].status, "done");
    const otherKey = createHash("sha256").update("synthetic-fork").digest("hex");
    assert.equal((await createProgressStore(otherKey, guide, base).read()).revision, 0);
});

test("concurrent writers reject stale revisions and preserve the winning update", async (t) => {
    const { base, store } = await fixture(t);
    const second = createProgressStore(key, guide, base);
    const results = await Promise.allSettled([
        store.update({ revision: 0, kind: "motion", motion: false }),
        second.update({ revision: 0, kind: "select", shell: "bash" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.code, "stale_progress");
    assert.equal((await store.read()).revision, 1);
});

test("reset requires confirmation and affects only the selected track", async (t) => {
    const { store } = await fixture(t);
    let state = await store.update({ revision: 0, kind: "step", step: guide.tracks.java[0].steps[0].id, status: "done" });
    state = await store.update({ revision: state.revision, kind: "select", track: "dotnet" });
    state = await store.update({ revision: state.revision, kind: "step", step: guide.tracks.dotnet[0].steps[0].id, status: "blocked", blocker: "review" });
    await assert.rejects(store.update({ revision: state.revision, kind: "reset" }), { code: "invalid_progress" });
    state = await store.update({ revision: state.revision, kind: "reset", confirmed: true });
    assert.deepEqual(state.tracks.dotnet.progress, {});
    assert.equal(Object.keys(state.tracks.java.progress).length, 1);
});

test("invalid fields, missing values, and unknown steps cannot overwrite progress", async (t) => {
    const { store } = await fixture(t);
    for (const input of [
        { revision: 0, kind: "select", track: "unknown" },
        { revision: 0, kind: "step", step: "unknown", status: "done" },
        { revision: 0, kind: "step", step: guide.tracks.java[0].steps[0].id, status: "blocked" },
        { revision: 0, kind: "select", lab: "08" },
        { revision: 0, kind: "select", step: guide.tracks.java[1].steps[0].id },
        { revision: 0, kind: "motion", motion: "false" },
        { revision: 0, kind: "motion", motion: false, notes: "not permitted" },
        { revision: 0, kind: "run", command: "not permitted" },
    ]) await assert.rejects(store.update(input), { code: "invalid_progress" });
    assert.equal((await store.read()).revision, 0);
});

test("corrupt saved state is reported and left byte-for-byte intact", async (t) => {
    const { base, store } = await fixture(t);
    const file = join(base, `${key}.json`);
    await writeFile(file, '{"invalid":');
    await assert.rejects(store.read(), /Saved data has not been replaced/);
    await assert.rejects(store.update({ revision: 0, kind: "motion", motion: false }));
    assert.equal(await readFile(file, "utf8"), '{"invalid":');
});

test("a non-directory storage path fails visibly without success-shaped state", async (t) => {
    const { base } = await fixture(t);
    const path = join(base, "not-a-directory");
    await writeFile(path, "synthetic");
    await assert.rejects(createProgressStore(key, guide, path).update({ revision: 0, kind: "motion", motion: false }));
});

test("HTTP enforces same-origin authorization, payload limits, allowed sources, and cleanup", async (t) => {
    const { store } = await fixture(t);
    const entry = await startServer({ guide, store, readSource: (source) => readSource(root, source) });
    const origin = new URL(entry.url).origin;
    t.after(entry.close);
    const html = await (await fetch(entry.url)).text();
    const token = /name="canvas-token" content="([a-f0-9]+)"/.exec(html)[1];
    const authorization = `Bearer ${token}`;
    assert.equal((await fetch(`${origin}/api/state`)).status, 403);
    assert.equal((await fetch(`${origin}/api/state`, { headers: { authorization, Origin: "https://foreign.invalid" } })).status, 403);
    assert.equal((await fetch(`${origin}/api/source?path=../../README.md`, { headers: { authorization } })).status, 400);
    const headers = { authorization, Origin: origin, "Content-Type": "application/json" };
    assert.equal((await fetch(`${origin}/api/update`, { method: "POST", headers: { authorization, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${origin}/api/update`, { method: "POST", headers, body: "invalid" })).status, 400);
    assert.equal((await fetch(`${origin}/api/update`, { method: "POST", headers, body: "x".repeat(9000) })).status, 413);
    const response = await fetch(`${origin}/api/update`, { method: "POST", headers, body: JSON.stringify({ revision: 0, kind: "motion", motion: false }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).motion, false);
    assert.equal((await fetch(`${origin}/api/update`, { method: "POST", headers, body: JSON.stringify({ revision: 0, kind: "motion", motion: true }) })).status, 409);
    assert.equal((await fetch(`${origin}/api/run`, { method: "POST", headers, body: "{}" })).status, 404);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    await entry.close();
    await assert.rejects(fetch(entry.url));
});
