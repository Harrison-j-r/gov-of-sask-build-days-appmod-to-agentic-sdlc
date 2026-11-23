import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { WorkbenchError, object, parseJson, publicError, readLimited, scopedPath } from "./common.mjs";

const contentTypes = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
};

export async function startServer({ publicRoot, state, action, evidence, subscribe, log }) {
    const token = randomBytes(32).toString("hex");
    const streams = new Set();
    let origin;
    const notify = () => {
        for (const stream of streams) stream.write('data: {"changed":true}\n\n');
    };
    const unsubscribe = subscribe(notify);
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
        try {
            if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
                throw new WorkbenchError("forbidden", "Foreign host or origin.", 403);
            }
            const url = new URL(req.url, origin);
            if (req.method === "GET" && url.pathname === "/") {
                const html = await readLimited(await scopedPath(publicRoot, "index.html"), 1024 * 1024);
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(html.toString("utf8").replaceAll("__WORKBENCH_TOKEN__", token));
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
                let relative;
                try { relative = decodeURIComponent(url.pathname.slice(1)); }
                catch { throw new WorkbenchError("invalid_path", "Invalid asset path."); }
                const type = contentTypes[path.extname(relative)];
                if (!type) throw new WorkbenchError("not_found", "Unknown asset type.", 404);
                const bytes = await readLimited(await scopedPath(publicRoot, relative));
                res.setHeader("Content-Type", type);
                res.end(bytes);
                return;
            }
            if (req.headers.authorization !== `Bearer ${token}`) {
                throw new WorkbenchError("forbidden", "Canvas authorization is required.", 403);
            }
            if (req.method === "GET" && url.pathname === "/api/events") {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Connection", "keep-alive");
                res.write('data: {"connected":true}\n\n');
                streams.add(res);
                res.on("close", () => streams.delete(res));
                return;
            }
            let result;
            if (req.method === "GET" && url.pathname === "/api/state") {
                result = await state();
            } else if (req.method === "GET" && url.pathname === "/api/evidence") {
                result = await evidence(url.searchParams.get("assessment"), url.searchParams.get("id"));
            } else if (req.method === "POST" && ["/api/action", "/api/import"].includes(url.pathname)) {
                if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") {
                    throw new WorkbenchError("forbidden", "Same-origin JSON is required.", 403);
                }
                const chunks = [];
                let size = 0;
                const limit = url.pathname === "/api/import" ? 32 * 1024 * 1024 : 128 * 1024;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > limit) throw new WorkbenchError("payload_limit", "Request exceeds this endpoint's size limit.", 413);
                    chunks.push(chunk);
                }
                const request = object(parseJson(Buffer.concat(chunks), "Request"), ["name", "input"]);
                if (url.pathname === "/api/import" && request.name !== "import_files") throw new WorkbenchError("invalid_input", "This endpoint accepts only report imports.");
                result = await action(request.name, request.input);
            } else {
                throw new WorkbenchError("not_found", "Unknown route or method.", 404);
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(result));
        } catch (error) {
            if (!(error instanceof WorkbenchError)) log(error);
            res.statusCode = error instanceof WorkbenchError ? error.status : 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(publicError(error)));
        }
    });
    server.requestTimeout = 120000;
    server.headersTimeout = 15000;
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
    } catch (error) {
        unsubscribe();
        throw error;
    }
    origin = `http://127.0.0.1:${server.address().port}`;
    let closing;
    return {
        url: `${origin}/`,
        close() {
            return closing ??= new Promise((resolve, reject) => {
                unsubscribe();
                for (const stream of streams) stream.end();
                streams.clear();
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        },
    };
}
