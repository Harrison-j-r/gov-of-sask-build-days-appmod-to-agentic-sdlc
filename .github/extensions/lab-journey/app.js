const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="canvas-token"]').content;
let guide;
let state;
let saving = false;
let refreshPromise;

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function button(text, callback, className) {
    const node = element("button", text, className);
    node.type = "button";
    node.addEventListener("click", callback);
    return node;
}

async function api(path, body) {
    const response = await fetch(path, {
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return result;
}

function error(message) {
    $("error-text").textContent = message;
    $("error").hidden = false;
}

async function mutate(change) {
    if (saving) { error("A checkpoint update is still saving. Retry after it finishes."); return; }
    saving = true;
    for (const id of ["track", "shell", "motion", "reset"]) $(id).disabled = true;
    $("workspace").inert = true;
    $("workspace").setAttribute("aria-busy", "true");
    try {
        state = await api("/api/update", { revision: state.revision, ...change });
        $("error").hidden = true;
        render();
        if (change.kind === "step") {
            $("status").textContent = change.status === "done" ? "Checkpoint saved. Remember to keep your validation evidence." : "Checkpoint updated.";
            if (change.status === "done") $("status").animate?.([{ opacity: 0 }, { opacity: 1 }], {
                duration: state.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 220 : 0,
            });
        }
    } catch (problem) {
        render();
        error(problem.message);
    } finally {
        saving = false;
        for (const id of ["track", "shell", "motion", "reset"]) $(id).disabled = false;
        $("workspace").inert = false;
        $("workspace").setAttribute("aria-busy", "false");
    }
}

function sourceLink(source, text, anchor) {
    return button(text, () => openSource(source, anchor), "source-link");
}

function inline(node, text, source) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
        node.append(document.createTextNode(text.slice(offset, match.index)));
        const value = match[0];
        if (value.startsWith("`")) node.append(element("code", value.slice(1, -1)));
        else if (value.startsWith("**")) node.append(element("strong", value.slice(2, -2)));
        else {
            const target = match[3];
            let link;
            if (/^https:\/\//i.test(target)) {
                link = element("a", match[2]);
                link.href = target;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            } else {
                const resolved = new URL(target, `https://local.invalid/${source}`);
                const path = decodeURIComponent(resolved.pathname.slice(1));
                if (resolved.origin === "https://local.invalid" && guide.sources.includes(path)) {
                    link = sourceLink(path, match[2], resolved.hash.slice(1));
                } else {
                    link = element("span", match[2]);
                    link.title = path.startsWith("facilitator/") ? "Facilitator material is not shown in this guide." : `Open in your checkout: ${target}`;
                }
            }
            node.append(link);
        }
        offset = match.index + value.length;
    }
    node.append(document.createTextNode(text.slice(offset)));
}

function codeMatchesTrack(code) {
    const other = state.track === "java" ? /dotnet-msbuild-diagnostics|check-dotnet|validate-dotnet/ : /maven-diagnostics|check-java|validate-java/;
    const current = state.track === "java" ? /maven-diagnostics|check-java|validate-java/ : /dotnet-msbuild-diagnostics|check-dotnet|validate-dotnet/;
    return !other.test(code) || current.test(code);
}

function markdown(container, body, source, directory = "Repository root unless the source changes directory") {
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    let paragraph = [];
    let context = "";
    let listItem;
    function flush() {
        if (!paragraph.length) return;
        const text = paragraph.join(" ");
        const p = element("p");
        inline(p, text, source);
        container.append(p);
        context = text;
        paragraph = [];
    }
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const fence = /^```(\S*)/.exec(line);
        if (fence) {
            listItem = undefined;
            flush();
            const block = [];
            while (++index < lines.length && !/^```/.test(lines[index])) block.push(lines[index]);
            const code = block.join("\n");
            const language = fence[1] || "text";
            if ((language === "powershell" || language === "bash") && language !== state.shell) {
                container.append(element("p", `${language === "powershell" ? "PowerShell" : "Bash"} alternative hidden. Change the shell above to view it.`, "alternative"));
                continue;
            }
            if (!codeMatchesTrack(code)) continue;
            const card = element("div", undefined, "code-card");
            const head = element("div", undefined, "code-head");
            head.append(element("span", language === "text" ? "Copilot prompt / source text" : language));
            const pre = element("pre");
            const codeNode = element("code", code);
            pre.append(codeNode);
            head.append(button("Copy", async () => {
                try {
                    await navigator.clipboard.writeText(code);
                    $("status").textContent = "Copied exactly as shown. Review before running or sending.";
                } catch {
                    const selection = getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(codeNode);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    error("Clipboard access was denied. The block is selected so you can copy it manually.");
                }
            }));
            card.append(head);
            if (language === "powershell" || language === "bash") {
                const cwd = /from the source root/i.test(context)
                    ? state.track === "java" ? "legacy-src/java-asset-manager" : "legacy-src/dotnet-bookcatalog/shared-legacy-app"
                    : directory;
                card.append(element("p", `Working directory: ${cwd}. Read the source context above; blocks may change directories.`, "cwd"));
            }
            card.append(pre);
            container.append(card);
        } else if (/^\|.*\|$/.test(line.trim()) && /^\|\s*:?-/.test(lines[index + 1] ?? "")) {
            listItem = undefined;
            flush();
            const wrapper = element("div", undefined, "source-table");
            const table = element("table");
            const header = element("tr");
            for (const cell of line.trim().slice(1, -1).split("|")) {
                const th = element("th");
                th.scope = "col";
                inline(th, cell.trim(), source);
                header.append(th);
            }
            const thead = element("thead");
            thead.append(header);
            table.append(thead);
            index++;
            const tbody = element("tbody");
            while (/^\|.*\|$/.test(lines[index + 1]?.trim() ?? "")) {
                const row = element("tr");
                for (const cell of lines[++index].trim().slice(1, -1).split("|")) {
                    const td = element("td");
                    inline(td, cell.trim(), source);
                    row.append(td);
                }
                tbody.append(row);
            }
            table.append(tbody);
            wrapper.append(table);
            container.append(wrapper);
        } else if (/^#{1,6} /.test(line)) {
            listItem = undefined;
            flush();
            const text = line.replace(/^#+ /, "");
            const heading = element("h3");
            heading.dataset.anchor = text.toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            inline(heading, text, source);
            container.append(heading);
        } else if (/^\s*[-*] |^\s*\d+\. /.test(line)) {
            flush();
            const item = element("p", undefined, "list-item");
            inline(item, line.replace(/^\s*[-*] /, "- ").replace(/\[ \]/g, "[ ]").replace(/\[x\]/g, "[x]"), source);
            container.append(item);
            listItem = item;
        } else if (!line.trim()) {
            listItem = undefined;
            flush();
        } else if (/^<!--|^\s*-->/.test(line)) {
            listItem = undefined;
            flush();
        } else if (listItem) {
            listItem.append(document.createTextNode(" "));
            inline(listItem, line.trim(), source);
        } else {
            paragraph.push(line.replace(/^>\s?/, ""));
        }
    }
    flush();
}

async function openSource(source, anchor) {
    try {
        const result = await api(`/api/source?path=${encodeURIComponent(source)}`);
        $("source-title").textContent = "Canonical lab source";
        $("source-path").textContent = source;
        $("source-body").replaceChildren();
        markdown($("source-body"), result.body, source);
        if (!$("source-dialog").open) $("source-dialog").showModal();
        if (anchor) {
            const heading = [...$("source-body").querySelectorAll("[data-anchor]")].find((node) => node.dataset.anchor === anchor);
            heading?.scrollIntoView({ block: "start" });
        }
    } catch (problem) { error(problem.message); }
}

function render() {
    const focus = document.activeElement?.id;
    document.documentElement.dataset.motion = state.motion ? "on" : "off";
    $("track").value = state.track;
    $("shell").value = state.shell;
    $("motion").checked = state.motion;
    $("platform").hidden = state.track !== "dotnet";
    $("platform").textContent = ".NET's classic BookCatalog baseline requires Windows, Visual Studio/MSBuild, .NET Framework 4.8, and LocalDB. Bash support is Git Bash on Windows, not macOS, Linux, or WSL.";
    const labs = guide.tracks[state.track];
    const saved = state.tracks[state.track];
    const lab = labs.find((item) => item.id === saved.lab);
    const step = lab.steps.find((item) => item.id === saved.step);
    if (!$("orientation").hasChildNodes()) {
        const orientation = element("details", undefined, "safety");
        orientation.append(element("summary", guide.orientation.title));
        markdown(orientation, guide.orientation.body, guide.orientation.source);
        orientation.append(sourceLink(guide.orientation.source, "Read the updated workshop README"));
        $("orientation").append(orientation);
    }
    const allSteps = labs.flatMap((item) => item.steps);
    const done = allSteps.filter((item) => saved.progress[item.id]?.status === "done").length;
    const percentage = Math.round(done / allSteps.length * 100);
    const nav = element("nav", undefined, "journey");
    nav.setAttribute("aria-label", "Workshop labs");
    nav.append(element("h2", "Your journey"), element("p", `${done} of ${allSteps.length} checkpoints · ${percentage}%`, "muted"));
    const meter = element("progress");
    meter.max = allSteps.length;
    meter.value = done;
    meter.setAttribute("aria-label", "Self-reported checklist progress");
    nav.append(meter);
    for (const item of labs) {
        const completed = item.steps.filter((part) => saved.progress[part.id]?.status === "done").length;
        const stop = button("", () => mutate({ kind: "select", lab: item.id }), "lab-stop");
        stop.id = `lab-${item.id}`;
        stop.setAttribute("aria-current", item.id === lab.id ? "step" : "false");
        stop.append(element("span", item.id, "stop-number"), element("span", item.title, "stop-title"),
            element("small", `${completed}/${item.steps.length}`));
        if (completed === item.steps.length) stop.classList.add("complete");
        nav.append(stop);
    }
    const content = element("section", undefined, "guide");
    const heading = element("div", undefined, "lab-heading");
    heading.append(element("span", `Lab ${lab.id} / ${state.track === "java" ? "Java" : ".NET"}`, "eyebrow"), element("h2", lab.title), element("p", lab.outcome));
    heading.append(sourceLink(lab.id === "04" ? step.source : lab.source, "Read the canonical lab source"));
    content.append(heading);
    const intro = element("details", undefined, "safety lab-intro");
    intro.append(element("summary", "Why this lab · time and starting context"));
    markdown(intro, lab.intro, lab.source);
    content.append(intro);
    const safety = element("details", undefined, "safety");
    safety.append(element("summary", "Workshop guardrails · copy only"));
    for (const rule of guide.safety) safety.append(element("p", rule));
    content.append(safety);
    const stepNav = element("div", undefined, "step-nav");
    stepNav.setAttribute("aria-label", "Lab steps");
    for (const [index, part] of lab.steps.entries()) {
        const pick = button("", () => mutate({ kind: "select", step: part.id }), "step-pick");
        pick.id = `pick-${part.id}`;
        pick.setAttribute("aria-current", part.id === step.id ? "step" : "false");
        const status = saved.progress[part.id]?.status ?? "todo";
        pick.append(element("span", status === "done" ? "✓" : status === "blocked" ? "!" : String(index + 1), `step-dot ${status}`), element("span", part.title));
        pick.setAttribute("aria-label", `${part.title}, ${status}`);
        stepNav.append(pick);
    }
    const article = element("article", undefined, "step-card");
    article.append(element("p", `Checkpoint ${lab.steps.indexOf(step) + 1} of ${lab.steps.length}`, "eyebrow"),
        element("h3", step.title), sourceLink(step.source, "Source and full context", step.anchor));
    const details = element("details", undefined, "step-details");
    details.open = true;
    details.append(element("summary", "Instructions and exercise blocks"));
    markdown(details, step.body, step.source, step.directory);
    article.append(details);
    const controls = element("div", undefined, "checkpoint-controls");
    const label = element("label", "My checkpoint status ");
    const select = element("select");
    select.id = "checkpoint-status";
    for (const [value, title] of [["todo", "Not yet"], ["done", "Done (self-reported)"], ["blocked", "Blocked"]]) {
        const option = element("option", title);
        option.value = value;
        select.append(option);
    }
    select.value = saved.progress[step.id]?.status ?? "todo";
    select.addEventListener("change", () => mutate({
        kind: "step", step: step.id, status: select.value, ...(select.value === "blocked" ? { blocker: "tools" } : {}),
    }));
    label.append(select);
    controls.append(label);
    if (select.value === "blocked") {
        const blockerLabel = element("label", "What's blocking me? ");
        const blocker = element("select");
        blocker.id = "blocker";
        for (const [value, title] of [["tools", "Tools / setup"], ["permissions", "Permissions"], ["review", "Human review"], ["validation", "Validation"], ["policy", "Policy / cloud limits"]]) {
            const option = element("option", title);
            option.value = value;
            blocker.append(option);
        }
        blocker.value = saved.progress[step.id].blocker;
        blocker.addEventListener("change", () => mutate({ kind: "step", step: step.id, status: "blocked", blocker: blocker.value }));
        blockerLabel.append(blocker);
        controls.append(blockerLabel);
    }
    article.append(controls, element("p", "Keep the real evidence in your reviewed lab artifacts. This tick does not run or verify anything.", "muted"));
    const index = lab.steps.indexOf(step);
    const paging = element("div", undefined, "paging");
    const previous = button("Previous step", () => mutate({ kind: "select", step: lab.steps[index - 1].id }));
    previous.disabled = index === 0;
    previous.id = "previous";
    const next = button(index < lab.steps.length - 1 ? "Next step →" : "Next lab →", () =>
        mutate(index < lab.steps.length - 1 ? { kind: "select", step: lab.steps[index + 1].id }
            : { kind: "select", lab: labs[labs.indexOf(lab) + 1].id }), "primary");
    next.id = "next";
    next.disabled = index === lab.steps.length - 1 && lab.id === "07";
    paging.append(previous, next);
    article.append(paging);
    content.append(stepNav, article);
    $("workspace").replaceChildren(nav, content);
    $("workspace").setAttribute("aria-busy", "false");
    if (focus) $(focus)?.focus({ preventScroll: true });
}

async function refresh(clearError = false) {
    if (!guide) { location.reload(); return; }
    if (saving) return;
    if (refreshPromise) return refreshPromise;
    refreshPromise = api("/api/state").then((next) => {
        if (!saving && next.revision >= state.revision) {
            if (next.revision > state.revision) { state = next; render(); }
            if (clearError === true) $("error").hidden = true;
        }
    }).catch((problem) => error(problem.message)).finally(() => { refreshPromise = undefined; });
    return refreshPromise;
}

$("track").addEventListener("change", () => mutate({ kind: "select", track: $("track").value }));
$("shell").addEventListener("change", () => mutate({ kind: "select", shell: $("shell").value }));
$("motion").addEventListener("change", () => mutate({ kind: "motion", motion: $("motion").checked }));
$("refresh").addEventListener("click", () => refresh(true));
$("close-source").addEventListener("click", () => $("source-dialog").close());
$("reset").addEventListener("click", () => $("reset-dialog").showModal());
$("cancel-reset").addEventListener("click", () => $("reset-dialog").close());
$("confirm-reset").addEventListener("click", async () => {
    $("reset-dialog").close();
    await mutate({ kind: "reset", confirmed: true });
});
window.addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden && !$("source-dialog").open && !$("reset-dialog").open) refresh(); }, 4000);
try {
    ({ guide, state } = await api("/api/guide"));
    render();
} catch (problem) {
    $("workspace").replaceChildren(element("p", "The guide could not load. Follow labs/README.md in your checkout while resolving the error."));
    $("workspace").setAttribute("aria-busy", "false");
    error(problem.message);
}
