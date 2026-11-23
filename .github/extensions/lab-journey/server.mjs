import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fail } from "./guide.mjs";

export async function startServer({ guide, store, readSource }) {
    const token = randomBytes(32).toString("hex");
    const assets = Object.fromEntries(await Promise.all(["index.html", "app.js", "style.css"].map(async (file) =>
        [file, await readFile(new URL(file, import.meta.url), "utf8")])));
    let origin;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        // The host mirrors its theme contract through inline stylesheets.
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
        try {
            if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
                throw fail("forbidden", "Foreign host or origin.");
            }
            const url = new URL(req.url, origin);
            const asset = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] }[url.pathname];
            if (asset && req.method === "GET") {
                res.setHeader("Content-Type", `${asset[1]}; charset=utf-8`);
                res.end(assets[asset[0]].replace("__CANVAS_TOKEN__", token));
                return;
            }
            if (req.headers.authorization !== `Bearer ${token}`) throw fail("forbidden", "Missing canvas authorization.");
            let result;
            if (url.pathname === "/api/guide" && req.method === "GET") result = { guide, state: await store.read() };
            else if (url.pathname === "/api/state" && req.method === "GET") result = await store.read();
            else if (url.pathname === "/api/source" && req.method === "GET") result = { source: url.searchParams.get("path"), body: await readSource(url.searchParams.get("path")) };
            else if (url.pathname === "/api/update" && req.method === "POST") {
                if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") throw fail("forbidden", "JSON and same-origin authorization are required.");
                if (Number(req.headers["content-length"]) > 8192) throw fail("payload_limit", "Request too large.");
                let body = "";
                let bytes = 0;
                for await (const chunk of req) {
                    bytes += chunk.length;
                    if (bytes > 8192) throw fail("payload_limit", "Request too large.");
                    body += chunk.toString("utf8");
                }
                let input;
                try { input = JSON.parse(body); } catch { throw fail("invalid_progress", "Request must contain valid JSON."); }
                result = await store.update(input);
            } else throw fail("not_found", "Unknown route or method.");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(result));
        } catch (error) {
            res.statusCode = error.code === "forbidden" ? 403 : error.code === "stale_progress" ? 409
                : error.code === "not_found" ? 404 : error.code === "payload_limit" ? 413
                    : ["invalid_progress", "source_not_allowed"].includes(error.code) ? 400 : 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ code: error.code ?? "guide_error", message: error.message }));
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    let closing;
    return {
        url: `${origin}/`,
        close: () => closing ??= new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}
