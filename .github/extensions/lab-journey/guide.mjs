import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

export function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

const definitions = [
    ["00", "Get ready", "Verify your tools and choose one application track.", "00-readiness"],
    ["01", "Define the change", "Plan first. Review and approve one durable specification.", "01-spec-driven-development"],
    ["02", "Shape the guidance", "Give Copilot precise rules and prove where they apply.", "02-copilot-instructions"],
    ["03", "Build your toolkit", "Create a bounded agent and try a read-only skill.", "03-custom-agents-and-skills"],
    ["04", "Modernize one slice", "Assess, reconcile, approve, execute, and verify.", "04-app-modernization"],
    ["05", "Connect the SDLC", "Compile guarded workflows. Live write runs are not required.", "05-agentic-workflows"],
    ["06", "Keep quality grounded", "Deterministic CI is authoritative; agentic QA is advisory.", "06-automated-qa"],
    ["07", "Show your capstone", "Demonstrate a small, validated slice using synthetic data.", "07-capstone"],
];

export const sources = [
    ...definitions.map(([, , , dir]) => `labs/${dir}/README.md`),
    "labs/04-app-modernization/java/README.md",
    "labs/04-app-modernization/dotnet/README.md",
    ...["01-assess-decide-plan", "02-execute-verify-local", "03-azure-deploy-cleanup"]
        .map((name) => `labs/04-app-modernization/dotnet/${name}.md`),
    ...["01-modernization-deep-dive", "02-public-service-app", "03-agentic-workflow"]
        .map((name) => `labs/07-capstone/pathways/${name}.md`),
    "specs/templates/change-specification.md",
    "specs/templates/autonomous-issue-body.md",
];

export function slug(value) {
    return value.toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function sections(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const headings = [];
    let fence = false;
    lines.forEach((line, index) => {
        if (/^```/.test(line)) fence = !fence;
        if (fence) return;
        const match = /^(#{1,3}) (.+)$/.exec(line);
        if (match) headings.push({ level: match[1].length, title: match[2], index });
    });
    return headings.map((heading, i) => {
        const end = headings.slice(i + 1).find((next) => next.level <= heading.level)?.index ?? lines.length;
        return { ...heading, body: lines.slice(heading.index + 1, end).join("\n").trim() };
    });
}

function trackContent(markdown, track) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    let excluded = false;
    return lines.filter((line) => {
        const heading = /^### (Java|\.NET)$/.exec(line);
        if (heading) excluded = heading[1] !== (track === "java" ? "Java" : ".NET");
        else if (/^#{1,2} /.test(line)) excluded = false;
        return !excluded;
    }).join("\n");
}

export async function readSource(root, source) {
    if (!sources.includes(source)) throw fail("source_not_allowed", "This source is not part of the participant guide.");
    const path = await realpath(resolve(root, ...source.split("/")));
    const base = await realpath(root);
    const rel = relative(base, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
        throw fail("source_not_allowed", "Source resolves outside this checkout.");
    }
    return readFile(path, "utf8");
}

function stepSections(markdown, lab) {
    const all = sections(markdown);
    if (lab === "01" || lab === "02") {
        const exercise = all.find((section) => section.title === "Exercise");
        if (!exercise) throw fail("source_changed", `Lab ${lab}: the Exercise section is missing.`);
        return sections(`## Exercise\n${exercise.body}`).filter((section) => section.level === 3);
    }
    return all.filter((section) => section.level === 2);
}

export async function loadGuide(root) {
    const documents = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, await readSource(root, source)])));
    const tracks = {};
    for (const track of ["java", "dotnet"]) {
        tracks[track] = definitions.map(([id, title, outcome, dir]) => {
            const source = `labs/${dir}/README.md`;
            const inputs = id !== "04" ? [source] : track === "java"
                ? ["labs/04-app-modernization/java/README.md"]
                : sources.filter((path) => path.startsWith("labs/04-app-modernization/dotnet/"));
            const steps = inputs.flatMap((path) => stepSections(trackContent(documents[path], track), id)
                .filter((section) => !/^(References|Current interface references|Troubleshooting|Time and prerequisites|Lab map)$/.test(section.title))
                .map((section) => ({
                    id: `${id}-${slug(path.split("/").at(-1))}-${slug(section.title)}`,
                    title: section.title,
                    source: path,
                    anchor: slug(section.title),
                    body: section.body,
                    directory: "Repository root unless the source context or command block changes directory",
                })));
            if (!steps.length || new Set(steps.map((step) => step.id)).size !== steps.length) {
                throw fail("source_changed", `Lab ${id}: missing or duplicate step sections; review the source.`);
            }
            return { id, title, outcome, source, steps };
        });
    }
    return {
        tracks, sources,
        platform: process.platform,
        safety: [
            "Checklist progress is self-reported, not a test result, human approval, or passing CI.",
            "Stay with one modernization track. A human approves the specification and technical plan before execution.",
            "The Java baseline has a known ResponseInputStream/Mockito test defect. Characterize it; do not call it a pass or disable it.",
            "Deterministic CI remains merge authority. Use pinned gh-aw v0.89.21; never hand-edit generated locks.",
            "Azure and live workflows are optional. Use an approved disposable environment and prove exact cleanup when resources were created.",
            "Copy only: this canvas never runs commands, sends prompts, authenticates, or changes GitHub.",
        ],
    };
}
