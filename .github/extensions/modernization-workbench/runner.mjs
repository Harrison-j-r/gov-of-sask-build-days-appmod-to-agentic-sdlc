import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, identifier, inside, object, parseJson } from "./common.mjs";
import { collectSource } from "./source.mjs";

const exec = promisify(execFile);

export function workerArguments(request, root) {
    object(request, ["id", "kind", "language", "mode", "sourceDigest", "planName", "prompt", "assessmentFile"]);
    identifier(request.id);
    if (!["java", "dotnet"].includes(request.language)) fail("invalid_job", "Unsupported language.");
    const source = path.join(root, "source");
    if (request.kind === "assess") {
        if (!["full", "issues"].includes(request.mode)) fail("invalid_job", "Unsupported assessment mode.");
        const args = ["assess", "--source", source, "--output-path", path.join(root, "output"), "--delegate", "local", "--format", "markdown", "--no-tty"];
        if (request.mode === "full") args.push("--assess-config", path.join(root, "assessment.yml"));
        return args;
    }
    if (request.kind === "plan") {
        identifier(request.planName);
        if (typeof request.prompt !== "string" || request.prompt.length > 20000) fail("invalid_job", "Invalid plan context.");
        if (request.assessmentFile !== "report.json") fail("invalid_job", "Invalid assessment reference.");
        return ["plan", "create", request.prompt, "--source", source, "--assess-file-path", path.join(root, "report.json"), "--plan-name", request.planName, "--language", request.language, "--no-tty"];
    }
    fail("invalid_job", "Only assessment and plan creation are supported.");
}

export async function runWorker(requestFile) {
    const resolved = await realpath(requestFile);
    if (path.basename(resolved) !== "request.json") fail("invalid_job", "A managed request.json is required.");
    const root = path.dirname(resolved);
    const requestBytes = await readFile(resolved);
    const request = parseJson(requestBytes, "Job request");
    const args = workerArguments(request, root);
    const source = await realpath(path.join(root, "source"));
    if (!inside(root, source)) fail("invalid_job", "Staged source escapes its run directory.");
    // Host policy was checked before copying; this verifies only the private staged bytes.
    const staged = await collectSource(root, "source", request.language, async () => true);
    if (staged.digest !== request.sourceDigest) fail("snapshot_changed", "Staged inputs do not match the approved source digest. Nothing was started.");
    const { stdout: version } = await exec("modernize", ["--version"], { windowsHide: true });
    if (!/^1\.0\.95(?:\+|\s|$)/.test(version.trim())) fail("unsupported_cli", "This run profile was verified against Modernize 1.0.95. Revalidate other CLI versions before use.");
    await writeFile(path.join(root, "started.json"), JSON.stringify({ requestHash: digest(requestBytes), pid: process.pid }), { flag: "wx", mode: 0o600 });
    if (request.kind === "assess" && request.mode === "full") await writeFile(path.join(root, "assessment.yml"), "analysisCoverage: full\n", { flag: "wx", mode: 0o600 });
    const logFile = path.join(root, "native.log");
    let pending = Promise.resolve();
    let bytesLogged = 0;
    let outputError = null;
    const result = await new Promise((resolve, reject) => {
        const child = spawn("modernize", args, { cwd: source, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        child.once("error", reject);
        const record = chunk => {
            const content = chunk.toString("utf8").replace(/GitHub account:[^\r\n]*/g, "GitHub account: [configured]")
                .replace(/(?:ghp_|github_pat_)[A-Za-z0-9_]+/g, "[redacted]");
            bytesLogged += Buffer.byteLength(content);
            if (bytesLogged > 32 * 1024 * 1024) {
                outputError = "Native output exceeded the log limit.";
                child.kill();
                return;
            }
            pending = pending.then(() => appendFile(logFile, content, { mode: 0o600 })).catch(error => {
                outputError = `Could not preserve native output: ${error.code || "write error"}`;
                child.kill();
            });
        };
        child.stdout.on("data", record);
        child.stderr.on("data", record);
        child.once("close", (code, signal) => resolve({ code, signal }));
    });
    await pending;
    for (const file of staged.files) {
        if (digest(await readFile(path.join(source, file.path))) !== file.digest) {
            outputError = "The native operation modified an approved input in its working copy. Reconcile the report before using it.";
            break;
        }
    }
    const record = { id: request.id, exitCode: result.code, signal: result.signal, error: outputError, finishedAt: new Date().toISOString() };
    const temporary = path.join(root, "result.tmp");
    await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    await rename(temporary, path.join(root, "result.json"));
    if (outputError || result.code !== 0) fail("native_failed", outputError || `Modernize exited with code ${result.code}. Review the run's native.log.`, 502);
    return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runWorker(process.argv[2]).then(result => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch(error => {
        process.stderr.write(`${error.code || "worker_failed"}: ${error.message}\n`);
        process.exitCode = 1;
    });
}
