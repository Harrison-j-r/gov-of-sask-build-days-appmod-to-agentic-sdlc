import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as api from "./api";
import { Distribution, Graph, Heatmap } from "./Visuals";
import { compareAssessments, type AppCandidate, type GapAction, type GapCard, type Selection, type WorkbenchState } from "./model";
import { Markdown } from "./Markdown";
import { StartPanel } from "./StartPanel";
import { CoverageGaps } from "./CoverageGaps";
import { EvidenceInspector } from "./EvidenceInspector";
import "./style.css";

const views = ["Understand the app", "Explore findings", "Compare destinations", "Make decisions", "Review the handoff"];
const shortViews = ["Application", "Findings", "Destinations", "Decisions", "Handoff"];
const questions = ["Explain this finding", "Show what this affects", "Challenge this recommendation", "Suggest a smaller first slice", "What is missing before approval?"];

function App() {
  const [data, setData] = useState<WorkbenchState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assessmentId, setAssessmentId] = useState("");
  const [view, setView] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [component, setComponent] = useState("");
  const [rationale, setRationale] = useState("");
  const [question, setQuestion] = useState("");
  const [destination, setDestination] = useState("Upgrade in place");
  const [constraints, setConstraints] = useState("");
  const [beforeId, setBeforeId] = useState("");
  const [page, setPage] = useState(0);
  const [runPanel, setRunPanel] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [appPath, setAppPath] = useState("");
  const [language, setLanguage] = useState("java");
  const [mode, setMode] = useState("full");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const next = await api.state<WorkbenchState>();
      if (sequence !== refreshSequence.current) return;
      setData(next);
      setAssessmentId(current => next.assessments.some(item => item.id === current) ? current : next.assessments.at(-1)?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the workbench.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const close = api.listen(() => { void refresh(); }, cause => setError(cause.message));
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { close(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  async function act(name: string, input: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api.act<{ assessmentId?: string }>(name, input);
      await refresh();
      if (result.assessmentId) { setAssessmentId(result.assessmentId); setShowStart(false); }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed. Existing state was preserved.");
      return false;
    } finally { setBusy(false); }
  }

  const assessment = data?.assessments.find(item => item.id === assessmentId);
  const finding = selected?.kind === "finding" ? assessment?.findings.find(item => item.id === selected.id) : undefined;
  const entity = finding ?? (selected?.kind === "component" ? assessment?.components.find(item => item.id === selected.id) :
    selected?.kind === "insight" ? assessment?.insights.find(item => item.id === selected.id) : undefined);
  const evidence = assessment?.evidence.filter(item => entity?.evidenceIds.includes(item.id)) ?? [];
  const findings = assessment?.findings.filter(item =>
    (!search || `${item.title} ${item.description} ${item.category} ${item.priority}`.toLowerCase().includes(search.toLowerCase())) &&
    (!category || item.category === category) && (!priority || item.priority === priority) &&
    (!component || item.componentIds.includes(component))) ?? [];
  const decisions = data?.decisions.filter(item => item.assessmentId === assessmentId) ?? [];
  const threads = data?.threads.filter(item => item.assessmentId === assessmentId && item.entityId === (selected?.id ?? null)) ?? [];
  const handoffs = data?.handoffs.filter(item => item.assessmentId === assessmentId) ?? [];
  const before = data?.assessments.find(item => item.id === beforeId);
  const comparison = before && assessment ? compareAssessments(before, assessment) : null;
  const reviewContext = data?.reviewContexts.find(item => item.id === data.activeReviewContextId);
  const sourceBinding = data?.sourceBindings.find(item => item.assessmentId === assessmentId);
  useEffect(() => { setPage(0); }, [search, category, priority, component, assessmentId, view]);

  function choose(kind: Selection["kind"], id: string) {
    setSelected({ kind, id });
    setRationale("");
  }

  async function ask(text = question) {
    if (!assessment || !text.trim()) return;
    if (await act("ask", { assessmentId, selection: selected, question: text, destination, constraints })) setQuestion("");
  }

  function prepareAssessment(app: AppCandidate) {
    setAppPath(app.relativePath); setLanguage(app.language); setMode("full"); setRunPanel(true); setShowStart(false);
    requestAnimationFrame(() => document.querySelector(".run-panel")?.scrollIntoView({ block: "start" }));
  }

  function gapAction(action: GapAction, gap: GapCard) {
    if (!action.enabled) return;
    if (action.kind === "import_folder") folderInput.current?.click();
    else if (action.kind === "import_report") fileInput.current?.click();
    else if (action.kind === "prepare_full" && reviewContext) prepareAssessment(reviewContext.app);
    else if (action.kind === "draft_question") {
      setSelected(null);
      setQuestion(`Help me understand this ${gap.title} gap: ${gap.detail} Explain the evidence needed and safe next steps. Do not run an assessment, edit files, or infer missing findings.`);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".chat textarea")?.focus());
    } else {
      setShowStart(true);
      requestAnimationFrame(() => document.getElementById(action.kind === "setup" ? "readiness-panel" : "start-panel")?.scrollIntoView({ block: "start" }));
    }
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files).filter(file => /\.(json|md|html)$/i.test(file.name));
    if (!selectedFiles.length) { setError("Choose a folder containing one native report.json and optional fact documents."); return; }
    if (selectedFiles.some(file => file.size > 25 * 1024 * 1024) || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) {
      setError("Choose a report bundle within 25 MiB per file and 30 MiB total.");
      return;
    }
    const bundle = await Promise.all(selectedFiles.map(async file => ({ name: file.webkitRelativePath || file.name, content: await file.text() })));
    await act("import_files", { files: bundle });
    if (fileInput.current) fileInput.current.value = "";
  }

  function findingTable(items = findings) {
    const pages = Math.max(1, Math.ceil(items.length / 100));
    const currentPage = Math.min(page, pages - 1);
    const rows = items.slice(currentPage * 100, currentPage * 100 + 100);
    return <div className="table-scroll"><table><caption>Finding locations, not unique rule counts</caption>
      <thead><tr><th scope="col">Finding</th><th scope="col">Category</th><th scope="col">Native priority</th><th scope="col">Decision</th></tr></thead>
      <tbody>{rows.map(item => <tr key={item.id} className={selected?.id === item.id ? "selected-row" : ""}>
        <td><button className="text-button" onClick={() => choose("finding", item.id)}>{item.title}</button>
          <small>{assessment?.evidence.find(ref => ref.id === item.evidenceIds[0])?.sourcePath || "Application-level finding"}</small></td>
        <td>{item.category}</td><td><span className={`badge priority-${item.priority}`}>{item.priority}</span></td>
        <td>{decisions.find(decision => decision.findingId === item.id)?.state ?? "Unreviewed"}</td>
      </tr>)}</tbody>
    </table>{pages > 1 && <div className="button-row"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><span>Page {currentPage + 1} of {pages} · {items.length} locations</span><button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next page</button></div>}
      {!items.length && <p className="empty-inline">No findings match this selection. This is not a clean bill of health; inspect coverage.</p>}</div>;
  }

  return <div className="workbench">
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">M</span>
      <div><strong>Modernization workbench</strong><small>Evidence. Decisions. A bounded next step.</small></div></div>
      <span className="badge">Personal workspace</span>
      <div className="top-actions"><button onClick={() => { setShowStart(!showStart); setRunPanel(false); }}>Start / app context</button>
        <button disabled={busy} onClick={() => { setError(""); void refresh(); }}>Refresh</button>
        <button disabled={busy} onClick={() => fileInput.current?.click()}>Import report</button>
        <button disabled={busy} onClick={() => folderInput.current?.click()}>Import folder</button>
        <button className="primary" disabled={busy} onClick={() => { setRunPanel(!runPanel); setShowStart(false); }}>Assess an app</button></div>
      <input ref={fileInput} className="visually-hidden" type="file" multiple accept=".json,.md,.html" aria-label="Choose native report files"
        onChange={event => { void importFiles(event.target.files).catch(cause => setError(String(cause))); }} />
      <input ref={element => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" multiple aria-label="Choose native report folder"
        onChange={event => { void importFiles(event.target.files).catch(cause => setError(String(cause))); }} />
    </header>
    {error && <div className="error-banner" role="alert"><strong>Action needs attention.</strong> {error}<button onClick={() => setError("")} aria-label="Dismiss error">Dismiss</button></div>}
    {runPanel && <section className="run-panel">
      <div><h2>Review an assessment request</h2><p>Choose one app inside this workspace. Source is staged into an isolated working copy. Native confirmation is required before AI or CLI work starts.</p></div>
      <label>App folder, relative to workspace<input value={appPath} onChange={event => setAppPath(event.target.value)} placeholder="legacy-src\\java-asset-manager\\..." /></label>
      <label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="java">Java</option><option value="dotnet" disabled>.NET - native prerequisite blocked</option></select></label>
      <label>Analysis<select value={mode} onChange={event => setMode(event.target.value)}><option value="full">Full analysis</option><option value="issues">Issue-only</option></select></label>
      <button className="primary" disabled={busy || !appPath.trim() || !data?.capabilities.nativeRuns}
        onClick={() => { void act("request_assessment", { relativePath: appPath, language, mode }); }}>Review in Copilot</button>
      {data?.capabilities.reasons.map(reason => <p className="warning" key={reason}>{reason}</p>)}
    </section>}
    <div className="context-bar">
      <span>{data?.workspace.name ?? "Loading workspace"}</span>
      <select aria-label="Select assessment" value={assessmentId} onChange={event => { setAssessmentId(event.target.value); setSelected(null); setCategory(""); setComponent(""); setPriority(""); setBeforeId(""); }}>
        {!data?.assessments.length && <option value="">No assessment loaded</option>}
        {data?.assessments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language} · {new Date(item.importedAt).toLocaleString()}</option>)}
      </select>
      {assessment && <><span className="badge">{assessment.language}</span><span className="badge">{data?.sourceRelationships[assessmentId] ?? assessment.sourceStatus}</span></>}
      {reviewContext && <span className="review-context-label">Review context: {reviewContext.app.name} · {reviewContext.goal}</span>}
    </div>
    <div className="layout">
      <nav className="navigation" aria-label="Assessment views">
        <div className="nav-label">MODERNIZATION JOURNEY</div>
        {shortViews.map((label, index) => <button key={label} className={!showStart && view === index ? "active" : ""} aria-current={!showStart && view === index ? "page" : undefined} onClick={() => { setView(index); setShowStart(false); }}>
          <span className="step">{index + 1}</span><span>{label}</span>
        </button>)}
        <div className="nav-foot"><strong>Review before you run</strong><p>No automatic upgrades or deployments. Every recommendation stays linked to its evidence.</p></div>
      </nav>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{showStart || !assessment ? "REVIEW SETUP" : `ASSESSMENT / ${shortViews[view].toUpperCase()}`}</div><h1>{showStart || !assessment ? "Start your review" : views[view]}</h1></div>
          {assessment && <span className="hint">{assessment.toolVersion}</span>}</div>
        {!data ? <p role="status">Loading the local workbench...</p> : showStart || !assessment ?
          <StartPanel data={data} assessment={assessment} busy={busy} onAction={act}
            onImport={folder => folder ? folderInput.current?.click() : fileInput.current?.click()}
            onContinue={() => setShowStart(false)} onPrepare={prepareAssessment} /> : <>
            <div className="metrics">
              {[["Components", assessment.components.length], ["Finding locations", assessment.findings.length], ["Included in scope", decisions.filter(item => item.state === "include").length],
                ["Reported domains", assessment.coverage.filter(item => item.state === "reported").length]].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <div className="review-status-strip"><span>{data.sourceRelationships[assessmentId]}</span><button onClick={() => setShowStart(true)}>Review setup and source link</button></div>
            {view !== 0 && assessment.warnings.length > 0 && <details className="evidence-limitations"><summary>{assessment.warnings.length} evidence limitations</summary>{assessment.warnings.map(warning => <p className="warning" key={warning}>{warning}</p>)}</details>}
            {view === 0 && <>
              <section className="card"><div className="section-heading"><div><h2>Application evidence map</h2><p>Reported components and source relationships. Not a measured runtime topology.</p></div></div>
                <Graph components={assessment.components} relationships={assessment.relationships} selected={selected?.kind === "component" ? selected.id : undefined} title="Application evidence map" onSelect={id => choose("component", id)} />
                <details><summary>Browse every component ({assessment.components.length})</summary><div className="component-list">{assessment.components.map(item =>
                  <button key={item.id} onClick={() => choose("component", item.id)}><strong>{item.name}</strong><span>{item.kind}</span></button>)}</div></details>
              </section>
              <CoverageGaps assessment={assessment} cards={data.gaps[assessmentId] ?? []} onAction={gapAction} />
              <section className="card"><h2>Codebase insights</h2>{assessment.insights.length ? <div className="component-list">{assessment.insights.map(item => <button key={item.id} onClick={() => choose("insight", item.id)}>{item.title}<small>{item.method}</small></button>)}</div> :
                <p>No native fact documents were supplied. Use contextual chat for an explicitly requested interpretation of the available evidence.</p>}</section>
            </>}
            {view === 1 && <>
              <div className="chart-grid"><Distribution findings={assessment.findings} field="category" label="Finding categories" select={setCategory} />
                <Distribution findings={assessment.findings} field="priority" label="Native remediation priority" select={setPriority} /></div>
              <section className="card"><h2>Where findings concentrate</h2><Heatmap components={assessment.components} findings={assessment.findings} choose={(id, value) => { setComponent(id); setCategory(value); }} /></section>
              <section className="card"><div className="section-heading"><h2>Inspect finding locations</h2><span>{findings.length} of {assessment.findings.length}</span></div>
                <div className="filters"><input aria-label="Search findings" placeholder="Search findings..." value={search} onChange={event => setSearch(event.target.value)} />
                  <span className="hint">{[category, priority, component && "Component selected"].filter(Boolean).join(" / ")}</span>
                  <button onClick={() => { setSearch(""); setCategory(""); setPriority(""); setComponent(""); }}>Clear filters</button></div>{findingTable()}
              </section>
            </>}
            {view === 2 && <>
              <div className="destination-grid">{["Upgrade in place", "Become Azure-ready", "Migrate to Azure"].map((name, index) => <button key={name} className={`destination-card ${destination === name ? "chosen" : ""}`} onClick={() => setDestination(name)}>
                <span className="eyebrow">OPTION {index + 1}</span><h2>{name}</h2><p>{["Focus on runtime and framework compatibility while preserving deployment assumptions.", "Prepare configuration, identity, hosting, and container boundaries without deploying.", "Review a named Azure target, its prerequisites, and migration tradeoffs."][index]}</p>
                <strong>{destination === name ? "Selected for discussion" : "Compare this option"}</strong></button>)}</div>
              <section className="card"><h2>Current versus proposed</h2><div className="comparison-grid"><div><h3>Current: reported evidence</h3><Graph components={assessment.components} relationships={assessment.relationships} title="Current components" onSelect={id => choose("component", id)} /></div>
                <div className="proposal"><span className="badge">Proposal, not fact</span><h3>{destination}</h3><p>No proposed architecture has been approved. Discuss a target using the current evidence; do not treat an inferred design as an observed system.</p>
                  <label>Target and constraints<textarea value={constraints} onChange={event => setConstraints(event.target.value)} placeholder="For example: Azure App Service; preserve existing public APIs; no database migration." /></label>
                  <button disabled={busy} onClick={() => { void ask(`Compare ${destination} with the current application. Explain prerequisites, gaps, and an evidence-linked proposed architecture. Do not generate files or run tools that modify source.`); }}>Discuss this destination</button></div></div>
              </section>
              <section className="card"><h2>Compare assessment snapshots</h2><select aria-label="Previous assessment" value={beforeId} onChange={event => setBeforeId(event.target.value)}><option value="">Choose a previous snapshot</option>
                {data.assessments.filter(item => item.id !== assessmentId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.importedAt}</option>)}</select>
                {comparison && <><p className="warning">Compare source, targets, and coverage before interpreting differences. Not observed does not mean resolved.</p>
                  <div className="metrics"><div className="metric"><span>Added fingerprints</span><strong>{comparison.added.length}</strong></div><div className="metric"><span>Not observed now</span><strong>{comparison.notObserved.length}</strong></div><div className="metric"><span>Shared fingerprints</span><strong>{comparison.shared.length}</strong></div></div></>}
              </section>
            </>}
            {view === 3 && <>
              <section className="card"><h2>Build a bounded slice</h2><p>Select a finding, inspect its evidence, and record a reason before including, deferring, or excluding it. These decisions do not modify the native report.</p></section>
              <div className="decision-board">{(["include", "defer", "exclude"] as const).map(state => <section className="card" key={state}><h2>{state === "include" ? "Include" : state === "defer" ? "Defer" : "Exclude"}</h2>
                {decisions.filter(item => item.state === state).map(decision => <button className="decision-card" key={decision.findingId} onClick={() => choose("finding", decision.findingId)}>
                  <strong>{assessment.findings.find(item => item.id === decision.findingId)?.title}</strong><p>{decision.rationale}</p></button>)}
                {!decisions.some(item => item.state === state) && <p className="hint">No decisions recorded here.</p>}</section>)}</div>
              <section className="card"><h2>Unreviewed findings</h2>{findingTable(assessment.findings.filter(item => !decisions.some(decision => decision.findingId === item.id)))}</section>
            </>}
            {view === 4 && <>
              <section className="card"><h2>Prepare a review packet</h2><p>Carry selected findings, reasons, evidence, validation gaps, and a proposed destination to Upgrade. Sending a packet requests review, not execution.</p>
                <label>Target and preservation constraints<textarea value={constraints} onChange={event => setConstraints(event.target.value)} placeholder="Describe the target, allowed scope, behavior to preserve, and validation requirements." /></label>
                <div className="button-row"><button disabled={busy || !decisions.some(item => item.state === "include")} onClick={() => { void act("prepare_handoff", { assessmentId, revision: data.revision, destination, constraints }); }}>Create review packet</button>
                  <button disabled={busy || !data.capabilities.nativePlans || assessment.sourceStatus !== "snapshot"} onClick={() => { void act("request_plan", { assessmentId, destination, constraints }); }}>Request native technical plan</button></div>
                {!data.capabilities.nativePlans && <p className="hint">Native plan execution is not enabled until its integration contract is verified.</p>}
              </section>
              <section className="card"><h2>Finding-to-validation traceability</h2><div className="table-scroll"><table><thead><tr><th>Included finding</th><th>Decision rationale</th><th>Preservation / validation</th></tr></thead><tbody>
                {decisions.filter(item => item.state === "include").map(decision => <tr key={decision.findingId}><td><button className="text-button" onClick={() => choose("finding", decision.findingId)}>{assessment.findings.find(item => item.id === decision.findingId)?.title}</button></td><td>{decision.rationale}</td><td>Needs explicit checks in the technical-plan review</td></tr>)}
              </tbody></table></div></section>
              {handoffs.map(packet => <section className="card" key={packet.id}><div className="section-heading"><h2>Review packet</h2><span className="badge">{packet.status}</span></div>
                {packet.gaps.map(gap => <p className="warning" key={gap}>{gap}</p>)}<Markdown>{packet.body}</Markdown>
                <div className="button-row"><button disabled={busy} onClick={() => { void navigator.clipboard.writeText(packet.body).catch(cause => setError(String(cause))); }}>Copy packet</button>
                  <button disabled={busy || packet.status === "sent for review"} onClick={() => { void act("send_handoff", { handoffId: packet.id, revision: data.revision }); }}>Review and send to Copilot</button></div>
              </section>)}
            </>}
          </>}
        {data?.jobs.length ? <section className="card jobs"><h2>Native work</h2>{data.jobs.map(job => <div key={job.id}><span className="badge">{job.status}</span><strong>{job.name}</strong><p>{job.message}</p>
          {["running", "awaiting approval"].includes(job.status) && <button disabled={busy} onClick={() => { void act("cancel_job", { id: job.id }); }}>Request cancellation</button>}</div>)}</section> : null}
      </main>
      <aside className="details" aria-label="Evidence and contextual chat">
        <EvidenceInspector assessment={assessment} selection={selected} binding={sourceBinding} revision={data?.revision ?? 0} busy={busy}
          rationale={rationale} setRationale={setRationale} onSelect={choose} onStart={() => setShowStart(true)}
          onDecision={state => { if (finding) void act("decide", { assessmentId, findingId: finding.id, state, rationale, revision: data?.revision }); }} />
        <section className="chat"><div className="eyebrow">DISCUSS WITH COPILOT</div><h2>Contextual conversation</h2>
          <p className="hint">Uses this Copilot session. Context: {assessment?.name ?? "none"} / {selected?.kind ?? "assessment"}{selected ? ` / ${selected.id}` : ""}.</p>
          <details><summary>Preview evidence sent with a question</summary><p>Question, selected destination/constraints, assessment coverage, and {entity ? `${evidence.length} selected evidence references` : "a bounded finding summary"}. Not the entire repository.</p></details>
          <div className="question-chips">{questions.map(item => <button key={item} disabled={!assessment || busy} onClick={() => setQuestion(item)}>{item}</button>)}</div>
          {threads.map(thread => <article className="thread" key={thread.id}><strong>{thread.question}</strong><span className="badge">{thread.status}</span>
            {thread.responses.map(response => <Markdown key={response.messageId}>{response.content}</Markdown>)}{thread.error && <p className="warning">{thread.error}</p>}</article>)}
          <form onSubmit={event => { event.preventDefault(); void ask(); }}><label>Ask about this context<textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="Explain the impact, challenge a recommendation, or compare options..." /></label>
            <button className="primary" disabled={busy || !assessment || !question.trim()}>Send to Copilot</button></form>
        </section>
      </aside>
    </div>
    <footer><span>Local evidence workspace</span><span>{busy ? "Applying your request..." : "Recommendations are not approvals. Unassessed is not passed."}</span></footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
