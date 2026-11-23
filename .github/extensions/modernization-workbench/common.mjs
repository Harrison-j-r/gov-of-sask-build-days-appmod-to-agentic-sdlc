import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

export class WorkbenchError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export function fail(code, message, status) {
    throw new WorkbenchError(code, message, status);
}

export function object(value, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input", "An object is required.");
    if (Object.keys(value).some(key => !fields.includes(key))) fail("invalid_input", "Unrecognized field.");
    return value;
}

export function text(value, name, max = 4000) {
    if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
        fail("invalid_input", `${name} must be nonempty text of at most ${max} characters.`);
    }
    return value;
}

export function identifier(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(value)) {
        fail("invalid_id", "Invalid artifact identifier.");
    }
    return value;
}

export function digest(value) {
    return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

export function newId(prefix) {
    return `${prefix}-${randomUUID()}`;
}

export function inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export async function scopedPath(root, relative, { directory = false } = {}) {
    text(relative, "Relative path", 2048);
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
        fail("path_outside_scope", "Use a relative path inside the selected source.");
    }
    const base = await realpath(root);
    const candidate = await realpath(path.resolve(base, relative));
    if (!inside(base, candidate)) fail("path_outside_scope", "The path escapes the selected source.");
    const info = await lstat(candidate);
    if (directory ? !info.isDirectory() : !info.isFile()) fail("invalid_path", "The selected path has the wrong file type.");
    return candidate;
}

export async function readLimited(file, maxBytes = 25 * 1024 * 1024) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) fail("invalid_path", "A regular file is required.");
    if (info.size > maxBytes) fail("payload_limit", `File exceeds the ${maxBytes}-byte limit.`, 413);
    const handle = await open(file, "r");
    try {
        const opened = await handle.stat();
        if (opened.ino !== info.ino || opened.dev !== info.dev || !opened.isFile()) fail("file_changed", "The input file changed while it was opened.");
        const bytes = await handle.readFile();
        const after = await lstat(file);
        if (after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev) fail("file_changed", "The input path changed while it was read.");
        if (bytes.length > maxBytes) fail("payload_limit", "File grew beyond the import limit.", 413);
        return bytes;
    } finally {
        await handle.close();
    }
}

export function parseJson(bytes, description) {
    try {
        return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        fail("invalid_json", `${description} is not valid JSON.`);
    }
}

export function publicError(error) {
    return {
        code: error instanceof WorkbenchError ? error.code : "operation_failed",
        message: error instanceof WorkbenchError ? error.message : "The operation failed. Inspect the extension log; existing data was preserved.",
    };
}
