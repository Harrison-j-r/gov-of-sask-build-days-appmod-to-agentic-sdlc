import { fileURLToPath } from "node:url";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { loadGuide, readSource } from "./guide.mjs";
import { createProgressStore, repositoryKey, updateSchema } from "./progress.mjs";
import { startServer } from "./server.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const guide = await loadGuide(root);
const store = createProgressStore(await repositoryKey(root), guide);
const servers = new Map();
const opens = new Map();

async function invoke(operation) {
    try {
        return await operation();
    } catch (error) {
        throw new CanvasError(error.code ?? "lab_guide_error", error.message);
    }
}

await joinSession({
    canvases: [createCanvas({
        id: "lab-journey",
        displayName: "Build Day lab guide",
        description: "Follow workshop Labs 00-07 with track-specific steps, copyable exercises, and private progress.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        actions: [
            {
                name: "get_progress",
                description: "Read compact private self-reported progress without changing it.",
                handler: () => invoke(() => store.read()),
            },
            {
                name: "get_guide",
                description: "Read source-backed labs and private self-reported progress; does not execute exercises.",
                handler: () => invoke(async () => ({ guide, state: await store.read() })),
            },
            {
                name: "update_progress",
                description: "Update private guide selections/checklists using the current revision; never validates lab work.",
                inputSchema: updateSchema,
                handler: (ctx) => invoke(() => store.update(ctx.input)),
            },
        ],
        open: (ctx) => invoke(async () => {
            await store.read();
            if (!servers.has(ctx.instanceId) && !opens.has(ctx.instanceId)) {
                opens.set(ctx.instanceId, startServer({
                    guide, store, readSource: (source) => readSource(root, source),
                }).then((entry) => {
                    servers.set(ctx.instanceId, entry);
                    return entry;
                }).finally(() => opens.delete(ctx.instanceId)));
            }
            const entry = servers.get(ctx.instanceId) ?? await opens.get(ctx.instanceId);
            return { title: "Build Day lab guide", url: entry.url };
        }),
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId) ?? await opens.get(ctx.instanceId);
            servers.delete(ctx.instanceId);
            if (entry) await entry.close();
        },
    })],
});
