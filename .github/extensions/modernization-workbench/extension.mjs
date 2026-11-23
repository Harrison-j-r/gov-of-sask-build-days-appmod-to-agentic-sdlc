import { fileURLToPath } from "node:url";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { startServer } from "./server.mjs";
import { inspectSetup, privateArtifactRoot } from "./setup.mjs";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const servers = new Map();
let initializing;

async function ready() {
    const setup = await inspectSetup(extensionRoot);
    if (!setup.ready) throw new CanvasError("workbench_setup_required", setup.message);
    if (!initializing) {
        initializing = (async () => {
            const { Workbench } = await import("./controller.mjs");
            const workbench = new Workbench(session, privateArtifactRoot(),
                error => session.log(`Workbench operation failed: ${error.code ?? "unexpected_error"}: ${error.message}`, { level: "error" }));
            try {
                await workbench.initialize();
                return workbench;
            } catch (error) {
                workbench.close();
                throw error;
            }
        })().catch(error => {
            initializing = undefined;
            throw error;
        });
    }
    return initializing;
}

const emptyInput = { type: "object", additionalProperties: false, properties: {} };
const session = await joinSession({
    canvases: [createCanvas({
        id: "modernization-workbench",
        displayName: "Modernization workbench",
        description: "Explore native modernization evidence, visual findings, scope decisions, and contextual Copilot chat before an Upgrade review.",
        inputSchema: emptyInput,
        actions: [
            {
                name: "get_setup",
                description: "Check local package/build prerequisites without installing tools or inspecting applications.",
                inputSchema: emptyInput,
                handler: () => inspectSetup(extensionRoot),
            },
            {
                name: "get_state",
                description: "Read a compact summary of this workspace's assessments, decisions, capability gaps, and jobs.",
                inputSchema: emptyInput,
                handler: async () => {
                    const workbench = await ready();
                    const state = await workbench.state();
                    const context = state.reviewContexts.find(item => item.id === state.activeReviewContextId);
                    return {
                        workspace: state.workspace, revision: state.revision, capabilities: state.capabilities,
                        readiness: state.readiness,
                        reviewContext: context ? { id: context.id, app: context.app, goal: context.goal } : null,
                        assessments: state.assessments.map(item => ({
                            id: item.id, name: item.name, language: item.language, findingLocations: item.findings.length,
                            components: item.components.length, sourceStatus: item.sourceStatus,
                            sourceRelationship: state.sourceRelationships[item.id], coverage: item.coverage,
                        })),
                        decisions: state.decisions.length, threads: state.threads.map(item => ({ id: item.id, status: item.status })),
                        jobs: state.jobs, handoffs: state.handoffs.map(item => ({ id: item.id, status: item.status })),
                    };
                },
            },
            {
                name: "import_files",
                description: "Import one explicitly supplied native report bundle without running AI or source analysis.",
                inputSchema: {
                    type: "object", additionalProperties: false, required: ["files"],
                    properties: {
                        files: {
                            type: "array", minItems: 1, maxItems: 128,
                            items: {
                                type: "object", additionalProperties: false, required: ["name", "content"],
                                properties: { name: { type: "string" }, content: { type: "string" } },
                            },
                        },
                    },
                },
                handler: async ctx => (await ready()).action("import_files", ctx.input),
            },
        ],
        open: async ctx => {
            const workbench = await ready();
            if (!servers.has(ctx.instanceId)) {
                const opening = startServer({
                    publicRoot: fileURLToPath(new URL("./public", import.meta.url)),
                    state: () => workbench.state(),
                    action: (name, input) => workbench.action(name, input),
                    evidence: (assessmentId, id) => workbench.evidence(assessmentId, id),
                    subscribe: handler => workbench.subscribe(handler),
                    log: error => session.log(`Workbench error: ${error.code ?? error.message}`, { level: "error" }),
                });
                servers.set(ctx.instanceId, opening);
                try { await opening; }
                catch (error) {
                    servers.delete(ctx.instanceId);
                    throw new CanvasError("workbench_open_failed", error.message);
                }
            }
            return { title: "Modernization workbench", url: (await servers.get(ctx.instanceId)).url };
        },
        onClose: async ctx => {
            const server = await servers.get(ctx.instanceId);
            servers.delete(ctx.instanceId);
            if (server) await server.close();
        },
    })],
});
