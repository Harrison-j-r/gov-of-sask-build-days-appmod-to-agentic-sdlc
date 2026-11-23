import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest, fail, inside, readLimited, scopedPath } from "./common.mjs";

const skipped = new Set([".git", ".vs", ".idea", "node_modules", "bin", "obj", "target", "dist", "build", ".gradle"]);
const sourceExtensions = new Set([".java", ".xml", ".gradle", ".kts", ".properties", ".yml", ".yaml", ".json", ".cs", ".csproj", ".sln", ".slnx", ".props", ".targets", ".config", ".resx", ".razor", ".cshtml", ".md", ".txt"]);

export function decodeSource(bytes) {
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    if (utf16 && bytes.length % 2) fail("source_encoding", "The UTF-16 input is incomplete.");
    const content = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le")
        : bytes[0] === 0xfe && bytes[1] === 0xff ? Buffer.from(bytes.subarray(2)).swap16().toString("utf16le")
            : bytes.toString("utf8").replace(/^\uFEFF/, "");
    if (content.includes("\0")) fail("source_encoding", "An input could not be safely inspected as text. Review its encoding.");
    return content;
}

export function inspectSourceText(content) {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|accountkey|clientsecret)\s*[=:]\s*["']?(?![${<\s])[^"'\s;]{8,}/i.test(content)) {
        fail("sensitive_source", "Potential secret material was detected. Values were not returned; review the selected source.");
    }
}

export async function collectSource(workspace, relativePath, language, checkPaths) {
    const root = await scopedPath(workspace, relativePath, { directory: true });
    const entries = await readdir(root, { withFileTypes: true });
    const buildFiles = entries.filter(entry => entry.isFile()).map(entry => entry.name);
    const supported = language === "java"
        ? buildFiles.some(name => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(name))
        : buildFiles.some(name => /\.(csproj|sln|slnx)$/i.test(name));
    if (!supported) fail("app_root_required", "Select one application's build root containing pom.xml, build.gradle, a project, or a solution.");
    const candidates = [];
    async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) fail("source_link", "Source contains a symlink or reparse point; review the source boundary before assessing.");
            if (skipped.has(entry.name)) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === ".github") continue;
                await walk(absolute);
            } else if (entry.isFile() && (sourceExtensions.has(path.extname(entry.name).toLowerCase()) || entry.name === "Dockerfile")) {
                if (/^\.env|credentials|secrets|\.pfx$|\.pem$|\.key$/i.test(entry.name)) fail("sensitive_source", "Potential credential material is present; review source exclusions before assessment.");
                candidates.push(absolute);
                if (candidates.length > 5000) fail("source_limit", "The selected app exceeds 5,000 source inputs. Narrow the application root.");
            }
        }
    }
    await walk(root);
    if (!(await checkPaths(candidates))) fail("content_excluded", "Some source inputs are excluded or policy evaluation is unavailable. No source was copied.");
    let size = 0;
    const files = [];
    for (const candidate of candidates.sort()) {
        if (!inside(root, await realpath(candidate))) fail("source_changed", "A source path changed during collection.");
        const bytes = await readLimited(candidate, 2 * 1024 * 1024);
        size += bytes.length;
        if (size > 50 * 1024 * 1024) fail("source_limit", "The selected app exceeds 50 MiB of source inputs.");
        const content = decodeSource(bytes);
        inspectSourceText(content);
        files.push({ path: path.relative(root, candidate), content, bytes, digest: digest(bytes) });
    }
    return { root, relativePath, language, files, digest: digest(files.map(file => [file.path, file.digest])), byteLength: size };
}

export async function stageSource(source, destination) {
    await mkdir(destination, { recursive: false });
    for (const file of source.files) {
        const target = path.resolve(destination, file.path);
        if (!inside(destination, target)) fail("path_outside_scope", "Invalid staged source path.");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { flag: "wx", mode: 0o600 });
    }
}

export async function unchanged(source) {
    const observed = [];
    async function enumerate(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) return false;
            if (skipped.has(entry.name) || entry.name === ".github") continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!(await enumerate(absolute))) return false;
            } else if (entry.isFile() && (sourceExtensions.has(path.extname(entry.name).toLowerCase()) || entry.name === "Dockerfile")) {
                observed.push(path.relative(source.root, absolute));
            }
        }
        return true;
    }
    if (!(await enumerate(source.root)) || JSON.stringify(observed.sort()) !== JSON.stringify(source.files.map(file => file.path).sort())) return false;
    for (const file of source.files) {
        const absolute = path.resolve(source.root, file.path);
        if (!inside(source.root, absolute) || !inside(source.root, await realpath(absolute))) return false;
        if (digest(await readFile(absolute)) !== file.digest) return false;
    }
    return true;
}

function manifestLanguage(name) {
    if (["pom.xml", "build.gradle", "build.gradle.kts"].includes(name.toLowerCase())) return "java";
    return /\.(csproj|sln|slnx)$/i.test(name) ? "dotnet" : null;
}

function candidate(workspace, directory, language, manifests) {
    const relativePath = path.relative(workspace, directory) || ".";
    const key = `${workspace}\0${relativePath}\0${language}`;
    return {
        id: `app-${digest(process.platform === "win32" ? key.toLowerCase() : key).slice(0, 32)}`,
        name: path.basename(directory), relativePath, language, manifests: manifests.slice().sort(),
    };
}

export async function discoverApplications(workspace, relativeRoot, checkPaths, limits = {}) {
    const bound = { entries: 10000, depth: 12, candidates: 200, ...limits };
    const base = await realpath(workspace);
    const root = await scopedPath(base, relativeRoot, { directory: true });
    const result = { candidates: [], warnings: [], partial: false, visited: 0, relativeRoot };
    const warnings = new Set();
    const warn = message => { result.partial = true; warnings.add(message); };
    async function walk(directory, depth) {
        if (result.visited >= bound.entries || result.candidates.length >= bound.candidates) { warn("Discovery reached its limit. Narrow the folder and search again."); return; }
        if (depth > bound.depth) { warn("Some folders exceed the discovery depth limit. Narrow the folder to inspect them."); return; }
        let entries;
        try {
            if ((await lstat(directory)).isSymbolicLink() || !inside(base, await realpath(directory))) { warn("A folder changed its source boundary during discovery."); return; }
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (!["EACCES", "EPERM", "ENOENT"].includes(error.code)) throw error;
            warn("Some folders were inaccessible or changed during discovery.");
            return;
        }
        const manifests = { java: [], dotnet: [] };
        const children = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (result.visited >= bound.entries) { warn("Discovery reached its entry limit. Narrow the folder and search again."); break; }
            result.visited++;
            if (entry.isSymbolicLink()) { warn("Links were not followed during discovery."); continue; }
            if (skipped.has(entry.name) || [".github", "vendor", "packages"].includes(entry.name)) continue;
            if (entry.isDirectory()) children.push(path.join(directory, entry.name));
            else if (entry.isFile()) {
                const language = manifestLanguage(entry.name);
                if (language) manifests[language].push(entry.name);
            }
        }
        for (const language of ["java", "dotnet"]) {
            if (!manifests[language].length) continue;
            if (result.candidates.length >= bound.candidates) { warn("Discovery reached its candidate limit. Narrow the folder and search again."); break; }
            if (!(await checkPaths(manifests[language].map(name => path.join(directory, name))))) {
                warn("Some candidates are excluded or source-policy evaluation is unavailable.");
                continue;
            }
            if (!inside(base, await realpath(directory))) { warn("A folder changed its source boundary during discovery."); continue; }
            result.candidates.push(candidate(base, directory, language, manifests[language]));
        }
        for (const child of children) {
            if (result.visited >= bound.entries || result.candidates.length >= bound.candidates) { warn("Discovery reached its limit. Narrow the folder and search again."); break; }
            await walk(child, depth + 1);
        }
    }
    await walk(root, 0);
    result.warnings = [...warnings];
    return result;
}

export async function validateCandidate(workspace, saved, checkPaths) {
    const base = await realpath(workspace);
    const root = await scopedPath(base, saved.relativePath, { directory: true });
    const manifests = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isFile() && manifestLanguage(entry.name) === saved.language).map(entry => entry.name);
    if (!manifests.length || !(await checkPaths(manifests.map(name => path.join(root, name))))) {
        fail("candidate_unavailable", "This app candidate changed or cannot be checked under the current source policy. Discover it again.");
    }
    const current = candidate(base, root, saved.language, manifests);
    if (current.id !== saved.id) fail("candidate_changed", "The selected candidate now resolves to a different folder.");
    return current;
}

export function relativeSourcePath(value) {
    if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes(":") || value.split(/[\\/]/).includes("..")) {
        fail("path_outside_scope", "The report does not provide a safe relative source path. It will not be opened automatically.");
    }
    return path.normalize(value);
}

export function sourceCandidates(reference) {
    if (!reference.sourcePath) return [];
    const location = relativeSourcePath(reference.sourcePath);
    const paths = [location];
    if (reference.projectPath && reference.projectPath !== ".") paths.push(path.join(relativeSourcePath(reference.projectPath), location));
    return [...new Set(paths)];
}

export async function resolvePreviewFile(root, candidates, manualPath) {
    if (manualPath) candidates = [relativeSourcePath(manualPath)];
    const found = [];
    for (const relative of candidates) {
        try {
            const file = await scopedPath(root, relative);
            if (/^\.env|credentials|secrets|\.pfx$|\.pem$|\.key$/i.test(path.basename(file))) fail("sensitive_source", "This source filename is not eligible for a code preview.");
            if (!sourceExtensions.has(path.extname(file).toLowerCase()) && path.basename(file) !== "Dockerfile") fail("source_type", "Only supported source-text files can be previewed.");
            found.push({ file, relativePath: relative });
        } catch (error) {
            if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        }
    }
    const unique = [...new Map(found.map(item => [item.file, item])).values()];
    if (!unique.length) return { status: "missing", message: "No matching source file is available in the selected app. Report evidence remains available.", candidates: [] };
    if (unique.length > 1) return { status: "ambiguous", message: "More than one file could match. Choose a mapping explicitly; matching a name does not verify the assessment.", candidates: unique.map(item => item.relativePath) };
    const selected = unique[0];
    const info = await lstat(selected.file);
    return { status: "resolved", ...selected, version: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}` };
}

export function sourceExcerpt(content, line, navigation = false) {
    const sourceLines = content.split(/\r\n|\n|\r/);
    const valid = Number.isInteger(line) && line > 0 && line <= sourceLines.length;
    if (!valid && !navigation) return { status: "line_unavailable", message: "The reported line is absent, invalid, or outside this file. You may explicitly open the beginning as navigation context.", lines: [], totalLines: sourceLines.length };
    const start = valid && !navigation ? Math.max(1, line - 20) : 1;
    const lines = [];
    let bytes = 0;
    let limited = false;
    for (let number = start; number <= sourceLines.length && lines.length < 120; number++) {
        const value = sourceLines[number - 1];
        if (bytes + Buffer.byteLength(value, "utf8") + 1 > 32 * 1024) { limited = true; break; }
        bytes += Buffer.byteLength(value, "utf8") + 1;
        lines.push({ number, text: value, highlighted: valid && !navigation && number === line });
    }
    if (!lines.length) return { status: "excerpt_limit", message: "A source line exceeds the 32 KiB excerpt limit. It was not truncated into misleading code.", lines: [], totalLines: sourceLines.length };
    return { status: "ready", lines, startLine: start, endLine: lines.at(-1).number, totalLines: sourceLines.length,
        truncated: limited || start > 1 || lines.at(-1).number < sourceLines.length, navigation,
        message: navigation ? "Navigation context only; this is not a validated finding location." : "Highlight shows the line number reported by the assessment, not a new verification of the finding." };
}
