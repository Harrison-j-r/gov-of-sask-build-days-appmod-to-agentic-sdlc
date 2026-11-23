import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

async function exists(file) {
    try { return (await lstat(file)).isFile(); }
    catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

export function privateArtifactRoot(copilotHome = process.env.COPILOT_HOME, home = homedir()) {
    return path.join(copilotHome || path.join(home, ".copilot"), "extensions", "modernization-workbench", "artifacts");
}

export async function inspectSetup(extensionRoot) {
    const manifest = JSON.parse(await readFile(path.join(extensionRoot, "package.json"), "utf8"));
    const packageFile = path.join(extensionRoot, "node_modules", "ajv", "package.json");
    const dependenciesInstalled = await exists(packageFile);
    const installedVersion = dependenciesInstalled ? JSON.parse(await readFile(packageFile, "utf8")).version : null;
    const dependencyReady = dependenciesInstalled && installedVersion === manifest.dependencies.ajv;
    const index = path.join(extensionRoot, "public", "index.html");
    let buildReady = await exists(index);
    if (buildReady) {
        const html = await readFile(index, "utf8");
        const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(match => match[1]);
        buildReady = assets.some(asset => asset.endsWith(".js")) && assets.some(asset => asset.endsWith(".css"));
        for (const asset of assets) {
            if (asset.includes("..") || asset.includes(":") || !(await exists(path.join(extensionRoot, "public", asset)))) buildReady = false;
        }
    }
    const ready = dependencyReady && buildReady;
    return {
        ready,
        dependencyReady,
        buildReady,
        message: ready
            ? "Local dependencies and renderer assets are present. This does not verify native modernization tools."
            : `Workbench setup is required. In ${extensionRoot}, run npm ci and npm run build, then reload extensions. No installation or build was started automatically.`,
    };
}
