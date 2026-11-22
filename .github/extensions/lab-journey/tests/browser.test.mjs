import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { loadGuide, readSource } from "../guide.mjs";
import { createProgressStore } from "../progress.mjs";
import { startServer } from "../server.mjs";

// npm exec exposes its transient package cache through PATH, not the repo.
const moduleDirectories = (process.env.PATH ?? "").split(delimiter).filter((path) => /node_modules[\\/]\.bin$/.test(path));
let playwrightPath;
for (const directory of moduleDirectories) {
    try { playwrightPath = createRequire(join(directory, "..", "package.json")).resolve("playwright"); break; }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
}
if (!playwrightPath) throw new Error("Run this optional UI gate through npm exec --package playwright --call as documented.");
const playwright = await import(pathToFileURL(playwrightPath).href);
const { chromium } = playwright.default ?? playwright;
const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("real browser: navigation, copies, safe source, reset, themes, narrow layout, motion, and resume", async (t) => {
    const base = await mkdtemp(join(tmpdir(), "lab-guide-browser-"));
    const guide = await loadGuide(root);
    const key = createHash("sha256").update("synthetic-browser-test").digest("hex");
    const store = createProgressStore(key, guide, base);
    const entry = await startServer({
        guide, store,
        readSource: async (source) => `${await readSource(root, source)}\n<script>window.untrustedSourceRan=true</script>\n[Unsafe](javascript:alert(1))`,
    });
    let browser;
    t.after(async () => {
        try { await browser?.close(); }
        finally { await entry.close(); await rm(base, { recursive: true, force: true }); }
    });
    browser = await chromium.launch({
        ...(process.env.LAB_GUIDE_BROWSER_PATH ? { executablePath: process.env.LAB_GUIDE_BROWSER_PATH } : { channel: process.env.LAB_GUIDE_BROWSER ?? "msedge" }),
        headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, colorScheme: "light", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(entry.url);
    await page.locator(".lab-stop").first().waitFor();
    assert.equal(await page.locator(".lab-stop").count(), 8);
    await page.locator("#orientation summary").click();
    assert.match(await page.locator("#orientation").textContent(), /Day 2/);
    await page.locator(".lab-intro summary").click();
    assert.match(await page.locator(".lab-intro").textContent(), /Why this lab/);
    assert.match(await page.locator(".lab-intro").textContent(), /Time/);
    assert.equal(await page.locator(".step-card h3").first().textContent(), "1. Choose one application track");
    await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.activeElement.matches("a, button, select, input, summary")));
    await page.getByRole("button", { name: "2. Run the shared check, todo", exact: true }).click();
    await page.locator(".code-card").first().waitFor();
    const exactBlock = await page.locator(".code-card pre code").first().textContent();
    await page.locator(".code-card button").first().click();
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Copied exactly"));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), exactBlock);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => Promise.reject(new Error("synthetic denial")) }));
    await page.locator(".code-card button").first().click();
    await page.locator("#error").waitFor({ state: "visible" });
    assert.match(await page.locator("#error-text").textContent(), /Clipboard access was denied/);
    assert.equal(await page.evaluate(() => getSelection().toString()), exactBlock);
    await page.locator(".step-card > .source-link").click();
    await page.locator("#source-dialog").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.untrustedSourceRan), undefined);
    assert.equal(await page.locator("#source-body script").count(), 0);
    assert.equal(await page.locator('#source-body a[href^="javascript:"]').count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#source-dialog").isVisible(), false);
    await page.locator("#checkpoint-status").selectOption("done");
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Checkpoint saved"));
    const second = await context.newPage();
    await second.goto(entry.url);
    await second.locator("#checkpoint-status").waitFor();
    assert.equal(await second.locator("#checkpoint-status").inputValue(), "done");
    await page.reload();
    await page.locator("#checkpoint-status").waitFor();
    assert.equal(await page.locator("#checkpoint-status").inputValue(), "done");
    await page.locator("#reset").click();
    await page.locator("#cancel-reset").click();
    assert.equal(await page.locator("#checkpoint-status").inputValue(), "done");
    await page.locator("#reset").click();
    await page.locator("#confirm-reset").click();
    await page.waitForFunction(() => document.querySelector(".step-card h3")?.textContent === "1. Choose one application track");
    await page.locator("#track").selectOption("dotnet");
    await page.waitForFunction(() => !document.getElementById("platform").hidden);
    await page.locator("#lab-04").click();
    await page.waitForFunction(() => document.querySelector(".lab-heading h2")?.textContent === "Modernize one slice");
    assert.equal(await page.locator(".step-card table tbody tr").count(), 3);
    assert.match(await page.locator(".step-card table").textContent(), /Code preparation/);
    assert.match(await page.locator("#platform").textContent(), /not macOS, Linux, or WSL/);
    await page.locator("#shell").selectOption("bash");
    await page.waitForFunction(() => document.getElementById("workspace").getAttribute("aria-busy") === "false");
    await page.locator("#motion").uncheck();
    await page.waitForFunction(() => document.documentElement.dataset.motion === "off").catch(async (problem) => {
        throw new Error(`${problem.message}; UI: ${await page.locator("#error-text").textContent()}; state: ${JSON.stringify(await store.read())}`);
    });
    assert.equal(await page.locator(".step-card").evaluate((node) => getComputedStyle(node).animationName), "none");
    const light = await page.locator("body").evaluate((node) => getComputedStyle(node).backgroundColor);
    if (process.env.LAB_GUIDE_SCREENSHOT) await page.screenshot({ path: process.env.LAB_GUIDE_SCREENSHOT, fullPage: true });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.locator("#motion").check();
    await page.waitForFunction(() => document.documentElement.dataset.motion === "on");
    assert.equal(await page.locator(".step-card").evaluate((node) => getComputedStyle(node).animationName), "none");
    const dark = await page.locator("body").evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(dark, light);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No narrow-panel horizontal overflow");
    if (process.env.LAB_GUIDE_NARROW_SCREENSHOT) await page.screenshot({ path: process.env.LAB_GUIDE_NARROW_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []);
});
