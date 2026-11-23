import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { Workbench } from "../controller.mjs";
import { startServer } from "../server.mjs";

test("real browser: import, linked evidence, persisted decisions, contextual chat, and denied runs", { timeout: 120000 }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modernization-workbench-browser-"));
    const listeners = new Set();
    const native = { sends: 0, executions: 0 };
    let confirmation = false;
    let lastPrompt = "";
    const errors = [];
    const session = {
        sessionId: "synthetic-browser-session",
        capabilities: { ui: { elicitation: true } },
        ui: { confirm: async () => confirmation },
        on: (_name, handler) => { listeners.add(handler); return () => listeners.delete(handler); },
        send: async options => {
            native.sends++;
            lastPrompt = options.prompt;
            const id = `synthetic-message-${native.sends}`;
            setTimeout(() => {
                for (const listener of listeners) listener({ data: { originatingMessageId: id, messageId: `response-${id}`, content: "Synthetic test-session response: the selected evidence remains linked." } });
            }, 20);
            return id;
        },
        rpc: {
            metadata: { snapshot: async () => ({ workingDirectory: root, workspacePath: root, isRemote: false }) },
            contentExclusion: { checkPaths: async ({ paths }) => ({ available: true, checks: paths.map(file => ({ path: file, excluded: false })) }) },
            shell: {
                executeUserRequested: async () => { native.executions++; throw new Error("No native process may run in browser tests."); },
                cancelUserRequested: async () => ({ cancelled: true }),
            },
        },
    };
    const workbench = new Workbench(session, path.join(root, "artifacts"), error => errors.push(error));
    await workbench.initialize();
    await mkdir(path.join(root, "review-app"));
    await mkdir(path.join(root, "dotnet-candidate"));
    const currentSource = ["<project>", ...Array.from({ length: 15 }, (_, i) => `<!-- SYNTHETIC_CURRENT_SOURCE_LINE_${i + 2} -->`), "</project>"].join("\n");
    await writeFile(path.join(root, "review-app", "pom.xml"), currentSource);
    await writeFile(path.join(root, "dotnet-candidate", "Example.csproj"), "<Project />");
    const server = await startServer({
        publicRoot: fileURLToPath(new URL("../public", import.meta.url)),
        state: () => workbench.state(),
        action: (name, input) => workbench.action(name, input),
        evidence: (assessmentId, id) => workbench.evidence(assessmentId, id),
        subscribe: handler => workbench.subscribe(handler),
        log: error => errors.push(error),
    });
    let browser;
    let browserServer;
    t.after(async () => {
        try {
            await server.close();
            workbench.close();
        } finally {
            if (browserServer) await browserServer.kill();
            if (browser) await browser.close();
            await rm(root, { recursive: true });
        }
    });
    browserServer = await chromium.launchServer({ channel: process.env.WORKBENCH_BROWSER || "msedge", headless: true });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on("pageerror", error => errors.push(error));
    await page.goto(server.url);
    console.log("Browser gate: opening and importing.");
    await page.getByRole("heading", { name: "Start a focused application review" }).waitFor();
    assert.equal(native.sends, 0);
    assert.equal(native.executions, 0);

    const fixture = await readFile(new URL("./native-java-full.json", import.meta.url));
    await page.getByLabel("Choose native report files").setInputFiles({ name: "report.json", mimeType: "application/json", buffer: fixture });
    await page.getByRole("heading", { name: "Application evidence map" }).waitFor();
    assert.equal((await workbench.state()).assessments[0].findings.length, 3);
    assert.equal(native.sends, 0);
    await page.getByRole("button", { name: "Start / app context", exact: true }).click();
    console.log("Browser gate: guided context and gap actions.");
    await page.getByRole("button", { name: "Find apps in this workspace", exact: true }).click();
    await page.getByLabel("Application candidate").selectOption({ label: "review-app · Java · review-app" });
    await page.getByLabel("Review goal", { exact: true }).selectOption({ label: "Review upgrade readiness" });
    await page.getByLabel("Review notes").fill("Keep this synthetic review bounded.");
    await page.getByRole("button", { name: "Save review context", exact: true }).click();
    await page.getByText("Saved: review-app · Review upgrade readiness", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Link current source to this report", exact: true }).click();
    await page.locator(".start-panel .source-badge").waitFor();
    assert.equal((await workbench.state()).assessments[0].sourceStatus, "unverified import");
    assert.equal(native.sends + native.executions, 0);
    await page.getByRole("button", { name: "Continue review", exact: true }).click();
    const architectureGap = page.locator(".gap-card").filter({ has: page.locator("summary strong", { hasText: "Architecture" }) });
    await architectureGap.locator("summary").click();
    await architectureGap.getByRole("button", { name: "Draft a question", exact: true }).click();
    assert.match(await page.getByLabel("Ask about this context").inputValue(), /Architecture gap/);
    assert.equal(native.sends, 0);
    await page.getByRole("navigation").getByRole("button").nth(1).click();
    await page.getByRole("heading", { name: "Inspect finding locations" }).waitFor();
    await page.getByRole("button", { name: "Java Version is not the latest LTS", exact: true }).first().click();
    console.log("Browser gate: read-only source preview.");
    await page.getByRole("tab", { name: "Guidance", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: "Code", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".source-code").count(), 0);
    await page.getByRole("button", { name: "Approve and preview current file", exact: true }).click();
    await page.getByText("Current source was not read because approval was declined.").waitFor();
    confirmation = true;
    await page.getByRole("button", { name: "Approve and preview current file", exact: true }).click();
    await page.getByLabel("Read-only source preview").waitFor();
    assert.match(await page.getByLabel("Read-only source preview").textContent(), /SYNTHETIC_CURRENT_SOURCE_LINE_10/);
    assert.equal((await page.locator(".reported-line .line-number").textContent()).trim(), "10");
    assert.equal(JSON.stringify(await workbench.state()).includes("SYNTHETIC_CURRENT_SOURCE_LINE"), false);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("Current-source preview was cleared when this window regained focus. Request a fresh preview to check for changes.").waitFor();
    assert.equal(await page.locator(".source-code").count(), 0);
    confirmation = false;
    await page.getByRole("tab", { name: "Guidance", exact: true }).click();
    await page.getByLabel("Decision reason").fill("Review Java compatibility and preserve synthetic search behavior.");
    await page.getByRole("button", { name: "include", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main")?.textContent?.includes("include"));
    assert.equal((await workbench.state()).decisions[0].state, "include");

    await page.getByLabel("Ask about this context").fill("Explain the selected native finding.");
    await page.getByRole("button", { name: "Send to Copilot", exact: true }).click();
    await page.getByText("Synthetic test-session response: the selected evidence remains linked.").waitFor();
    assert.equal(native.sends, 1);
    assert.equal(lastPrompt.includes("SYNTHETIC_CURRENT_SOURCE_LINE"), false, "Previewed code must not enter chat implicitly.");
    console.log("Browser gate: persistence, handoff, and denied runs.");
    const second = await browser.newPage();
    await second.goto(server.url);
    await second.getByRole("heading", { name: "Application evidence map" }).waitFor();
    await second.getByRole("navigation").getByRole("button").nth(3).click();
    await second.getByText("Review Java compatibility and preserve synthetic search behavior.").waitFor();
    await second.close();

    await page.getByRole("navigation").getByRole("button").nth(4).click();
    await page.getByLabel("Target and preservation constraints").fill("Java 21 proposal only. Preserve search results. No deployment or database work.");
    await page.getByRole("button", { name: "Create review packet", exact: true }).click();
    await page.getByRole("heading", { name: "Review packet", exact: true }).waitFor();
    await page.getByRole("button", { name: "Review and send to Copilot", exact: true }).click();
    assert.equal(native.sends, 1, "Declined native confirmation must not submit a handoff.");
    assert.equal((await workbench.state()).handoffs[0].status, "draft review request");

    await mkdir(path.join(root, "synthetic-app"));
    await writeFile(path.join(root, "synthetic-app", "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");
    await page.getByRole("button", { name: "Assess an app", exact: true }).click();
    await page.getByLabel("App folder, relative to workspace").fill("synthetic-app");
    await page.getByRole("button", { name: "Review in Copilot", exact: true }).click();
    await page.getByText("No assessment was launched.").waitFor();
    assert.equal(native.executions, 0);

    const malicious = JSON.parse(fixture.toString());
    malicious.projects[0].properties.appName = 'Unsafe <img src=x onerror="window.injected=true">';
    malicious.rules["dockerfile-00000"].description = '<script>window.injected=true</script>[bad](javascript:alert(1))';
    await page.getByLabel("Choose native report files").setInputFiles({ name: "report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malicious)) });
    await page.waitForFunction(() => document.querySelector('select[aria-label="Select assessment"]')?.textContent?.includes("Unsafe"));
    await page.getByRole("navigation").getByRole("button").nth(1).click();
    await page.getByRole("button", { name: "No Dockerfile found", exact: true }).first().click();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);

    const stress = JSON.parse(fixture.toString());
    console.log("Browser gate: bounded large-data and responsive views.");
    stress.projects[0].properties.appName = "SYNTHETIC STRESS FIXTURE";
    stress.projects[0].incidents = Array.from({ length: 5000 }, (_, index) => ({
        ...stress.projects[0].incidents[0], incidentId: `synthetic-${index}`,
        location: `src/Example${index % 499}.java`, line: index + 1,
    }));
    stress.summary.totalIncidents = 5000;
    await page.getByLabel("Choose native report files").setInputFiles({ name: "report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(stress)) });
    await page.waitForFunction(() => document.querySelector('select[aria-label="Select assessment"]')?.textContent?.includes("SYNTHETIC STRESS FIXTURE"));
    await page.getByText("Page 1 of 50", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page.getByText("Page 2 of 50", { exact: false }).waitFor();
    const large = (await workbench.state()).assessments.find(item => item.name === "SYNTHETIC STRESS FIXTURE");
    assert.equal(large.findings.length, 5000);
    assert.equal(large.components.length, 500);

    await page.setViewportSize({ width: 540, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("navigation").getByRole("button").nth(0).click();
    await page.getByRole("heading", { name: "Application evidence map" }).waitFor();
    await page.keyboard.press("Tab");
    assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.evaluate(() => {
        document.documentElement.style.setProperty("--background-color-default", "#ffffff");
        document.documentElement.style.setProperty("--text-color-default", "#1f2328");
        document.documentElement.style.setProperty("--border-color-default", "#d1d9e0");
    });
    assert.equal(await page.locator("html").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(errors.length, 0, errors.map(error => error.stack).join("\n"));
    console.log("Browser gate: all assertions completed.");
});
