import { readFile, mkdir, writeFile, rename, unlink, rmdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fail } from "./guide.mjs";

export const updateSchema = {
    type: "object", additionalProperties: false,
    properties: {
        revision: { type: "integer", minimum: 0 },
        kind: { enum: ["select", "step", "motion", "reset"] },
        track: { enum: ["java", "dotnet"] },
        shell: { enum: ["powershell", "bash"] },
        lab: { type: "string", pattern: "^0[0-7]$" },
        step: { type: "string", maxLength: 180 },
        status: { enum: ["todo", "done", "blocked"] },
        blocker: { enum: ["tools", "permissions", "review", "validation", "policy"] },
        motion: { type: "boolean" },
        confirmed: { const: true },
    },
    required: ["revision", "kind"],
};

export async function repositoryKey(root) {
    let identity = resolve(root, ".git");
    try {
        const marker = await readFile(identity, "utf8");
        const match = /^gitdir: (.+)\r?$/m.exec(marker);
        if (!match) throw fail("repository_identity", "Invalid worktree .git marker.");
        const gitdir = resolve(root, match[1].trim());
        // Common checkout identity without reading outside the current worktree.
        identity = /[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) ? dirname(dirname(gitdir)) : gitdir;
    } catch (error) {
        if (!["EISDIR", "EPERM"].includes(error.code)) throw error;
        // Windows reports EPERM when reading a directory; check the marker is a directory.
        const { stat } = await import("node:fs/promises");
        if (!(await stat(identity)).isDirectory()) throw error;
    }
    if (process.platform === "win32") identity = identity.toLowerCase();
    return createHash("sha256").update(identity).digest("hex");
}

function assert(condition, message) {
    if (!condition) throw fail("invalid_progress", message);
}

function exactKeys(object, allowed) {
    assert(object !== null && typeof object === "object" && !Array.isArray(object), "Expected an object.");
    assert(Object.keys(object).every((key) => allowed.includes(key)), "Unknown progress field.");
}

export function createProgressStore(key, guide, base = join(process.env.COPILOT_HOME ?? join(homedir(), ".copilot"), "extensions", "lab-journey", "artifacts")) {
    assert(/^[a-f0-9]{64}$/.test(key), "Invalid repository identity.");
    const file = join(base, `${key}.json`);
    const lock = `${file}.lock`;
    const stepIds = Object.fromEntries(["java", "dotnet"].map((track) => [track,
        new Set(guide.tracks[track].flatMap((lab) => lab.steps.map((step) => step.id)))]));
    const initial = () => ({
        version: 1, revision: 0, track: "java", shell: process.platform === "win32" ? "powershell" : "bash", motion: true,
        tracks: Object.fromEntries(["java", "dotnet"].map((track) => [track, {
            lab: "00", step: guide.tracks[track][0].steps[0].id, progress: {},
        }])),
    });
    function validate(state) {
        exactKeys(state, ["version", "revision", "track", "shell", "motion", "tracks"]);
        assert(state.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0, "Unsupported or corrupt progress version/revision.");
        assert(["java", "dotnet"].includes(state.track) && ["powershell", "bash"].includes(state.shell) && typeof state.motion === "boolean", "Invalid guide selections.");
        exactKeys(state.tracks, ["java", "dotnet"]);
        for (const track of ["java", "dotnet"]) {
            const data = state.tracks[track];
            exactKeys(data, ["lab", "step", "progress"]);
            const lab = guide.tracks[track].find((item) => item.id === data.lab);
            assert(lab?.steps.some((step) => step.id === data.step), "Saved navigation no longer matches the lab source.");
            exactKeys(data.progress, [...stepIds[track]]);
            for (const item of Object.values(data.progress)) {
                exactKeys(item, ["status", "blocker"]);
                assert(["done", "blocked"].includes(item.status), "Invalid step status.");
                assert(item.status === "blocked"
                    ? ["tools", "permissions", "review", "validation", "policy"].includes(item.blocker)
                    : !("blocker" in item), "Invalid blocker category.");
            }
        }
        return state;
    }
    async function read() {
        try {
            return validate(JSON.parse(await readFile(file, "utf8")));
        } catch (error) {
            if (error.code === "ENOENT") return initial();
            throw fail(error.code ?? "invalid_progress", `Cannot read private progress: ${error.message}. Saved data has not been replaced.`);
        }
    }
    async function update(input) {
        exactKeys(input, Object.keys(updateSchema.properties));
        assert(Number.isSafeInteger(input.revision) && input.revision >= 0, "Revision is required.");
        assert(updateSchema.properties.kind.enum.includes(input.kind), "Unknown update operation.");
        const required = {
            select: ["track", "shell", "lab", "step"], step: ["step", "status", "blocker"],
            motion: ["motion"], reset: ["confirmed"],
        };
        assert(Object.keys(input).every((field) => ["kind", "revision", ...required[input.kind]].includes(field)), "Fields do not match the operation.");
        await mkdir(base, { recursive: true, mode: 0o700 });
        let acquired = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            try { await mkdir(lock); acquired = true; break; }
            catch (error) { if (error.code !== "EEXIST") throw error; await delay(50); }
        }
        if (!acquired) throw fail("progress_busy", "Progress is locked by another writer. Retry; if a provider crashed, see the documented lock recovery.");
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
            const state = await read();
            if (state.revision !== input.revision) throw fail("stale_progress", "Progress changed in another panel. Refresh before trying again.");
            const data = state.tracks[state.track];
            if (input.kind === "select") {
                if (input.track !== undefined) {
                    assert(["java", "dotnet"].includes(input.track), "Unknown track.");
                    state.track = input.track;
                }
                if (input.shell !== undefined) {
                    assert(["powershell", "bash"].includes(input.shell), "Unknown shell.");
                    state.shell = input.shell;
                }
                const selected = state.tracks[state.track];
                if (input.lab !== undefined) {
                    const lab = guide.tracks[state.track].find((item) => item.id === input.lab);
                    assert(lab, "Unknown lab.");
                    selected.lab = lab.id;
                    selected.step = lab.steps[0].id;
                }
                if (input.step !== undefined) selected.step = input.step;
            } else if (input.kind === "step") {
                assert(stepIds[state.track].has(input.step), "Unknown step.");
                assert(["todo", "done", "blocked"].includes(input.status), "Unknown status.");
                if (input.status === "todo") delete data.progress[input.step];
                else data.progress[input.step] = input.status === "done"
                    ? { status: "done" } : { status: "blocked", blocker: input.blocker };
            } else if (input.kind === "motion") {
                assert(typeof input.motion === "boolean", "Motion must be boolean.");
                state.motion = input.motion;
            } else {
                assert(input.confirmed === true, "Reset requires explicit confirmation.");
                state.tracks[state.track] = initial().tracks[state.track];
            }
            state.revision++;
            validate(state);
            await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
            await rename(temp, file);
            return state;
        } finally {
            try {
                try { await unlink(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
            } finally {
                await rmdir(lock);
            }
        }
    }
    return { read, update };
}
