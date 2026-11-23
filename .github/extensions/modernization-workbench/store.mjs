import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { digest, fail, identifier, newId, parseJson } from "./common.mjs";

export async function replaceFile(source, target, { renameFile = rename, wait = delay, platform = process.platform } = {}) {
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            await renameFile(source, target);
            return;
        } catch (error) {
            // Windows readers and scanners can temporarily deny atomic replacement.
            if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === 7) throw error;
            await wait(25 * (attempt + 1));
        }
    }
}

export class ArtifactStore {
    constructor(root) {
        this.root = root;
    }

    file(id) {
        return path.join(this.root, `${identifier(id)}.json`);
    }

    async read(id) {
        let bytes;
        try {
            bytes = await readFile(this.file(id));
        } catch (error) {
            if (error.code === "ENOENT") fail("not_found", "The requested artifact does not exist.", 404);
            throw error;
        }
        const record = parseJson(bytes, "Stored artifact");
        if (!record || record.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 1 || !("data" in record)) {
            fail("invalid_store", "Stored artifact is invalid; it was not reset.", 500);
        }
        return record;
    }

    async locked(id, operation) {
        await mkdir(this.root, { recursive: true });
        const lock = `${this.file(id)}.lock`;
        for (let attempt = 0; ; attempt++) {
            try {
                await mkdir(lock);
                break;
            } catch (error) {
                if (error.code !== "EEXIST") throw error;
                if (attempt === 49) fail("artifact_busy", "Another writer owns this artifact. Refresh before retrying; do not remove an active lock.", 409);
                await delay(20);
            }
        }
        try {
            return await operation();
        } finally {
            await rmdir(lock);
        }
    }

    async persist(record) {
        const target = this.file(record.id);
        const temporary = `${target}.${newId("write")}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
            await replaceFile(temporary, target);
        } finally {
            try {
                await unlink(temporary);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
        }
        return record;
    }

    async create(id, data) {
        return this.locked(id, async () => {
            try {
                await readFile(this.file(id));
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
                return this.persist({ id, revision: 1, updatedAt: new Date().toISOString(), data });
            }
            fail("already_exists", "An artifact with this identity already exists.", 409);
        });
    }

    async update(id, expectedRevision, change) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail("invalid_revision", "An expected revision is required.");
        return this.locked(id, async () => {
            const current = await this.read(id);
            if (current.revision !== expectedRevision) fail("stale_revision", "This artifact changed in another panel. Refresh and review your change.", 409);
            const data = await change(structuredClone(current.data));
            return this.persist({ id, revision: current.revision + 1, updatedAt: new Date().toISOString(), data });
        });
    }
}

export function repositoryKey(canonicalDirectory) {
    const identity = process.platform === "win32" ? canonicalDirectory.toLowerCase() : canonicalDirectory;
    return `repo-${digest(identity).slice(0, 32)}`;
}
