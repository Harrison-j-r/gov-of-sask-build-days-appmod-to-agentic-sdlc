import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectSetup, privateArtifactRoot } from "../setup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowedRootFiles = new Set([
    ".gitignore", ".npmrc", "README.md", "copilot-extension.json", "package.json", "package-lock.json",
    "extension.mjs", "setup.mjs", "assessment.mjs", "common.mjs", "controller.mjs", "copilot-bridge.mjs",
    "handoff.mjs", "review.mjs", "runner.mjs", "server.mjs", "source.mjs", "store.mjs", "tsconfig.json", "vite.config.ts",
]);
const sourceFolders = new Set(["schemas", "tests", "ui"]);
const localFolders = new Set(["node_modules", "public", "artifacts", ".cache", "coverage", "playwright-report", "test-results"]);

test("clean-checkout setup errors are actionable without installing or creating state", async t => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "workbench-distribution-"));
    t.after(() => rm(temporary, { recursive: true }));
    await writeFile(path.join(temporary, "package.json"), JSON.stringify({ dependencies: { ajv: "8.20.0" } }));
    const missing = await inspectSetup(temporary);
    assert.equal(missing.ready, false);
    assert.equal(missing.dependencyReady, false);
    assert.equal(missing.buildReady, false);
    assert.match(missing.message, /npm ci and npm run build/);
    assert.deepEqual(await readdir(temporary), ["package.json"]);

    await mkdir(path.join(temporary, "node_modules", "ajv"), { recursive: true });
    await writeFile(path.join(temporary, "node_modules", "ajv", "package.json"), '{"version":"8.20.0"}');
    assert.equal((await inspectSetup(temporary)).dependencyReady, true);
    assert.equal((await inspectSetup(temporary)).ready, false);
    await mkdir(path.join(temporary, "public", "assets"), { recursive: true });
    await writeFile(path.join(temporary, "public", "index.html"), '<script src="./assets/test.js"></script><link href="./assets/test.css">');
    assert.equal((await inspectSetup(temporary)).ready, false, "An index with missing assets is not a usable build.");
    await writeFile(path.join(temporary, "public", "assets", "test.js"), "");
    await writeFile(path.join(temporary, "public", "assets", "test.css"), "");
    assert.equal((await inspectSetup(temporary)).ready, true);
    await writeFile(path.join(temporary, "node_modules", "ajv", "package.json"), '{"version":"0.0.0"}');
    assert.equal((await inspectSetup(temporary)).ready, false);
});

test("project installation keeps artifacts in the user home and preserves the extension identity", async () => {
    const home = path.resolve("synthetic-user-home");
    assert.equal(privateArtifactRoot("", home), path.join(home, ".copilot", "extensions", "modernization-workbench", "artifacts"));
    const override = path.resolve("synthetic-copilot-home");
    assert.equal(privateArtifactRoot(override, home), path.join(override, "extensions", "modernization-workbench", "artifacts"));
    const manifest = JSON.parse(await readFile(path.join(root, "copilot-extension.json"), "utf8"));
    assert.deepEqual(manifest, { name: "modernization-workbench", version: 1 });
    const entry = await readFile(path.join(root, "extension.mjs"), "utf8");
    assert.match(entry, /await import\("\.\/controller\.mjs"\)/);
    assert.doesNotMatch(entry, /import \{ Workbench \} from/);
    assert.match(entry, /privateArtifactRoot\(\)/);
});

test("distribution is source-only with public dependency URLs and no personal state", async () => {
    const ignores = await readFile(path.join(root, ".gitignore"), "utf8");
    for (const directory of localFolders) assert.ok(ignores.includes(`/${directory}/`), `Missing ignore for ${directory}`);
    for (const entry of await readdir(root, { withFileTypes: true })) {
        assert.ok(entry.isDirectory() ? sourceFolders.has(entry.name) || localFolders.has(entry.name) : allowedRootFiles.has(entry.name), `Unreviewed distribution entry: ${entry.name}`);
    }
    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    for (const [name, pkg] of Object.entries(lock.packages)) {
        if (!name || !pkg.resolved) continue;
        assert.equal(new URL(pkg.resolved).origin, "https://registry.npmjs.org", `Nonpublic registry dependency: ${name}`);
    }
    assert.equal((await readFile(path.join(root, ".npmrc"), "utf8")).trim(), "registry=https://registry.npmjs.org/");
    for (const file of ["native-java-full.json", "native-java-issues.json"]) {
        const fixture = await readFile(path.join(root, "tests", file), "utf8");
        assert.match(fixture, /workbench-contract-catalog/);
        assert.doesNotMatch(fixture, /[A-Za-z]:\\\\|\/Users\/|\/home\/|github_pat_[A-Za-z0-9_]+/);
    }
});
