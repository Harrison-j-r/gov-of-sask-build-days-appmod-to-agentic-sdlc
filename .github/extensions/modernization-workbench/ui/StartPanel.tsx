import { useEffect, useState } from "react";
import * as api from "./api";
import type { AppCandidate, Assessment, Discovery, WorkbenchState } from "./model";

export function StartPanel({ data, assessment, busy, onAction, onImport, onContinue, onPrepare }: {
  data: WorkbenchState;
  assessment?: Assessment;
  busy: boolean;
  onAction: (name: string, input: unknown) => Promise<boolean>;
  onImport: (folder: boolean) => void;
  onContinue: () => void;
  onPrepare: (app: AppCandidate) => void;
}) {
  const context = data.reviewContexts.find(item => item.id === data.activeReviewContextId);
  const binding = data.sourceBindings.find(item => item.assessmentId === assessment?.id);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [searchRoot, setSearchRoot] = useState(".");
  const [candidateId, setCandidateId] = useState(context?.app.id ?? "");
  const [goal, setGoal] = useState(context?.goal ?? "Understand the app");
  const [notes, setNotes] = useState(context?.notes ?? "");
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setCandidateId(context?.app.id ?? "");
    setGoal(context?.goal ?? "Understand the app");
    setNotes(context?.notes ?? "");
  }, [context?.id, context?.savedAt]);
  const candidates = [...new Map([...data.reviewContexts.map(item => item.app), ...(discovery?.candidates ?? [])].map(app => [app.id, app])).values()];
  const selected = candidates.find(item => item.id === candidateId);
  async function discover() {
    setError("");
    setDiscovering(true);
    try { setDiscovery(await api.act<Discovery>("discover_apps", { relativePath: searchRoot })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "App discovery failed."); }
    finally { setDiscovering(false); }
  }
  return <section className="start-panel" id="start-panel" aria-label="Guided review start">
    <div className="start-intro card">
      <div><span className="eyebrow">START WITH THE RIGHT CONTEXT</span><h2>Start a focused application review</h2>
        <p>Choose one app, understand the evidence you have, and decide the next safe step. Setup does not run an assessment.</p></div>
      <div className="button-row"><button onClick={() => onImport(false)} disabled={busy}>Import a report</button>
        <button onClick={() => onImport(true)} disabled={busy}>Import a report folder</button>
        <button className="primary" onClick={onContinue} disabled={!assessment}>Continue review</button></div>
    </div>
    <div className="start-columns">
      <section className="card">
        <div className="section-heading"><h2><span className="step">1</span> Choose an app</h2><span className="badge">Metadata only</span></div>
        <p>No source content is read by discovery. Candidates come from build-manifest filenames, not an inferred business boundary.</p>
        <label>Discovery folder, relative to workspace<input value={searchRoot} onChange={event => setSearchRoot(event.target.value)} placeholder="." /></label>
        <div className="button-row"><button disabled={busy || discovering || !searchRoot.trim()} onClick={() => { void discover(); }}>{discovering ? "Finding app candidates..." : "Find apps in this workspace"}</button></div>
        {error && <p role="alert" className="warning">{error}</p>}
        {discovery?.warnings.map(warning => <p key={warning} className="warning">{warning}</p>)}
        {discovery && <p className="hint">{discovery.candidates.length} candidates from {discovery.visited} visited entries. {discovery.partial ? "Results are partial; narrow the folder to continue." : "Metadata discovery completed."}</p>}
        <label>Application candidate<select aria-label="Application candidate" value={candidateId} onChange={event => setCandidateId(event.target.value)}>
          <option value="">Select a candidate explicitly</option>
          {candidates.map(app => <option key={app.id} value={app.id}>{app.name} · {app.language === "java" ? "Java" : ".NET"} · {app.relativePath}</option>)}
        </select></label>
        {selected && <div className="context-detail"><strong>{selected.name}</strong><code>{selected.relativePath}</code><small>{selected.manifests.join(", ")}</small>
          {selected.language === "dotnet" && <p className="warning">Candidate discovery is available. Native .NET assessment and report support remain gated.</p>}</div>}
      </section>
      <section className="card">
        <h2><span className="step">2</span> Save the review goal</h2>
        <label>Review goal<select aria-label="Review goal" value={goal} onChange={event => setGoal(event.target.value)}>
          <option>Understand the app</option><option>Review upgrade readiness</option><option>Review cloud readiness</option>
        </select></label>
        <label>Review notes<textarea maxLength={6000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What should this review explain or preserve?" /></label>
        <p className="hint">This is review context, not a native CLI target configuration or permission to read source.</p>
        <button className="primary" disabled={busy || !selected} onClick={() => { void onAction("save_review_context", { candidateId, goal, notes, revision: data.revision }); }}>Save review context</button>
        {context && <p className="saved-context" role="status">Saved: {context.app.name} · {context.goal}</p>}
      </section>
    </div>
    <section className="card">
      <h2><span className="step">3</span> Connect context to evidence</h2>
      <p>Selected report: <strong>{assessment?.name ?? "None yet"}</strong>. Linking current source is a user-provided association, not proof that the report assessed those files.</p>
      {binding && <p className="source-badge">Current source linked: <code>{binding.relativePath}</code> · unverified against this assessment</p>}
      <div className="button-row">
        <button disabled={busy || !context || !assessment || (assessment.language === "Java" && context.app.language !== "java")}
          onClick={() => { void onAction("link_current_source", { contextId: context?.id, assessmentId: assessment?.id, revision: data.revision }); }}>Link current source to this report</button>
        {binding && <button disabled={busy} onClick={() => { void onAction("unlink_current_source", { assessmentId: assessment?.id, revision: data.revision }); }}>Unlink current source</button>}
        <button disabled={busy || context?.app.language !== "java" || !data.capabilities.nativeRuns} onClick={() => { if (context) onPrepare(context.app); }}>Prepare existing assessment request</button>
      </div>
      <p className="hint">Code previews require their own explicit action. Current-file access requires native approval. Native assessment requests retain the existing confirmation gates.</p>
    </section>
    <details className="card readiness-panel" id="readiness-panel" open>
      <summary>Readiness and recorded prerequisites</summary>
      <div className="readiness-grid">{data.readiness.map(card => <div key={card.id}><div className="section-heading"><h3>{card.title}</h3><span className="badge">{card.status.replaceAll("_", " ")}</span></div>
        <p>{card.detail}</p><small>{card.observation}{card.observedAt ? ` · ${card.observedAt}` : ""}</small></div>)}</div>
      <p className="hint">This panel performs no network checks, tool installations, or authentication changes. Report review works independently of blocked native integrations.</p>
    </details>
  </section>;
}
