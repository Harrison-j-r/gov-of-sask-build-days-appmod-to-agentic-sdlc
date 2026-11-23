import { useEffect, useId, useRef, useState } from "react";
import * as api from "./api";
import { Markdown } from "./Markdown";
import type { Assessment, DecisionState, Selection, SourceBinding, SourcePreview } from "./model";

const provenance = {
  snapshot_matched: "Assessment snapshot: hash matched",
  current_unverified: "Current source: unverified against assessment",
  current_matches_snapshot: "Current file matches recorded snapshot bytes",
};

export function EvidenceInspector({ assessment, selection, binding, revision, busy, rationale, setRationale, onDecision, onSelect, onStart }: {
  assessment?: Assessment; selection: Selection | null; binding?: SourceBinding; revision: number; busy: boolean;
  rationale: string; setRationale: (value: string) => void; onDecision: (state: DecisionState) => void;
  onSelect: (kind: Selection["kind"], id: string) => void; onStart: () => void;
}) {
  const finding = selection?.kind === "finding" ? assessment?.findings.find(item => item.id === selection.id) : undefined;
  const component = selection?.kind === "component" ? assessment?.components.find(item => item.id === selection.id) : undefined;
  const insight = selection?.kind === "insight" ? assessment?.insights.find(item => item.id === selection.id) : undefined;
  const entity = finding ?? component ?? insight;
  const evidence = assessment?.evidence.filter(item => entity?.evidenceIds.includes(item.id)) ?? [];
  const [tab, setTab] = useState("guidance");
  const [evidenceId, setEvidenceId] = useState("");
  const [mode, setMode] = useState("current");
  const [mapping, setMapping] = useState("");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const tabsId = useId();
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    setEvidenceId(evidence[0]?.id ?? "");
    setMode(assessment?.source ? "snapshot" : "current");
    setMapping(""); setPreview(null); setError(""); setLoading(false); setTab("guidance");
  }, [assessment?.id, selection?.id, binding?.revision]);
  useEffect(() => {
    const invalidateCurrent = () => {
      if (!loading && preview?.kind?.startsWith("current")) {
        sequence.current++;
        setPreview({ status: "refresh_required", message: "Current-source preview was cleared when this window regained focus. Request a fresh preview to check for changes.", lines: [] });
      }
    };
    window.addEventListener("focus", invalidateCurrent);
    return () => window.removeEventListener("focus", invalidateCurrent);
  }, [preview, loading]);
  const reference = evidence.find(item => item.id === evidenceId) ?? evidence[0];
  async function load(navigation = false) {
    if (!assessment || !reference) return;
    const request = ++sequence.current;
    setLoading(true); setError(""); setPreview(null);
    try {
      const next = await api.act<SourcePreview>("request_source_preview", {
        assessmentId: assessment.id, evidenceId: reference.id, mode, revision, navigation,
        ...(mapping ? { relativeFile: mapping } : {}),
      });
      if (sequence.current === request) setPreview(next);
    } catch (cause) {
      if (sequence.current === request) setError(cause instanceof Error ? cause.message : "Source preview failed.");
    } finally { if (sequence.current === request) setLoading(false); }
  }
  return <section className="evidence-inspector">
    <div className="eyebrow">EVIDENCE INSPECTOR</div>
    <h2>{finding?.title ?? component?.name ?? insight?.title ?? "Select something to explore"}</h2>
    {!entity ? <p className="hint">Select a finding, component, or document. Report guidance appears first; source access stays explicit.</p> : <>
      {finding && <div className="reported-domains"><span className="badge">{finding.category}</span><span className="badge">Priority: {finding.priority}</span><span className="badge">Severity: {finding.severity}</span></div>}
      <div className="inspector-tabs" role="tablist" aria-label="Evidence sections" onKeyDown={event => {
        const values = ["guidance", "code", "raw"];
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (values.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        setTab(values[index]);
        requestAnimationFrame(() => document.getElementById(`${tabsId}-${values[index]}`)?.focus());
      }}>{[["guidance", "Guidance"], ["code", "Code"], ["raw", "Raw evidence"]].map(([value, label]) =>
        <button key={value} id={`${tabsId}-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} aria-controls={`${tabsId}-panel`} aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`}>
        {tab === "guidance" && <>
          {finding && <><h3>Report guidance</h3><Markdown>{finding.description}</Markdown>
            {finding.recommendation.trim() && finding.recommendation.trim() !== finding.description.trim() && <><h3>Reported recommendation</h3><Markdown>{finding.recommendation}</Markdown></>}
            <h3>Referenced components</h3><div className="reference-chips">{finding.componentIds.map(id => <button key={id} onClick={() => onSelect("component", id)}>{assessment?.components.find(item => item.id === id)?.name ?? id}</button>)}</div>
            <p className="hint">These are reported inventory relationships, not verified runtime impact.</p>
            {!!finding.targets?.length && <p className="hint">Reported targets: {finding.targets.join(", ")}</p>}
          </>}
          {component && <><h3>Reported component</h3><p>{component.kind}</p><pre>{component.detail}</pre></>}
          {insight && <><span className="badge">{insight.method}</span><Markdown>{insight.body}</Markdown></>}
          <h3>Evidence references</h3>{evidence.map(ref => <div className="source-reference" key={ref.id}><strong>{ref.sourcePath || ref.title}{ref.line ? `:${ref.line}` : ""}</strong>
            <small>{ref.artifact} {ref.locator}</small><button onClick={() => { setEvidenceId(ref.id); setPreview(null); setTab("code"); }}>Inspect source availability</button></div>)}
        </>}
        {tab === "code" && <>
          <p className="hint">No file is read when this tab opens. Snapshot bytes and linked current files have different provenance.</p>
          <label>Evidence location<select aria-label="Evidence location" value={reference?.id ?? ""} onChange={event => { sequence.current++; setEvidenceId(event.target.value); setPreview(null); setError(""); setMapping(""); setLoading(false); }}>
            {evidence.map(ref => <option key={ref.id} value={ref.id}>{ref.sourcePath || ref.title}{ref.line ? `:${ref.line}` : ""}</option>)}
          </select></label>
          {!reference?.sourcePath ? <p className="hint">This evidence has no reported source file. A location will not be invented.</p> : <>
            <label>Source view<select aria-label="Source view" value={mode} onChange={event => { sequence.current++; setMode(event.target.value); setPreview(null); setError(""); setMapping(""); setLoading(false); }}>
              <option value="snapshot">Assessment snapshot</option><option value="current">Linked current source</option>
            </select></label>
            {mode === "current" && !binding && <div className="warning"><p>No current app is linked to this report. Linking does not verify historical evidence or grant file access.</p><button onClick={onStart}>Choose and link an app</button></div>}
            {binding && mode === "current" && <p className="source-badge"><code>{binding.relativePath}</code> · user-linked, not historically verified</p>}
            <button className="primary" disabled={busy || loading || (mode === "current" && !binding)} onClick={() => { void load(); }}>
              {loading ? "Waiting for source preview..." : mode === "current" ? "Approve and preview current file" : "Load owned snapshot"}
            </button>
            {error && <p role="alert" className="warning">{error}</p>}
            {preview && <div className="preview-result">
              {preview.kind && <strong className="source-badge">{provenance[preview.kind]}</strong>}
              <p className="hint">{preview.message}</p>
              {!!preview.candidates?.length && <label>Resolve reported location<select aria-label="Resolve reported location" value={mapping} onChange={event => setMapping(event.target.value)}><option value="">Choose a mapping explicitly</option>
                {preview.candidates.map(candidate => <option key={candidate}>{candidate}</option>)}</select></label>}
              {preview.status === "line_unavailable" && <button disabled={loading || busy} onClick={() => { void load(true); }}>Show beginning as navigation context</button>}
              {preview.fileLabel && <small>{preview.fileLabel} · {preview.mapping}</small>}
              {preview.digest && <small>SHA-256 {preview.digest}</small>}
              {!!preview.lines.length && <pre className="source-code" aria-label="Read-only source preview" tabIndex={0}><code>{preview.lines.map(line =>
                <span key={line.number} className={`source-line ${line.highlighted ? "reported-line" : ""}`}><span className="line-number" aria-label={`Line ${line.number}${line.highlighted ? ", reported location" : ""}`}>{line.number}</span><span>{line.text || " "}</span></span>)}</code></pre>}
              {preview.truncated && <p className="hint">Showing lines {preview.startLine}-{preview.endLine} of {preview.totalLines}. Excerpts are bounded to 120 lines / 32 KiB.</p>}
            </div>}
            <p className="hint">Previews are read-only, not live-watched, and are not added to Copilot questions. Request a fresh preview after source changes.</p>
          </>}
        </>}
        {tab === "raw" && <><p className="hint">Original report evidence, retained separately from source links and personal decisions.</p>
          {evidence.map(ref => <details key={ref.id}><summary>{ref.title}</summary><small>{ref.artifact} {ref.locator}</small><pre>{ref.text}</pre><code>{ref.id}</code></details>)}</>}
      </div>
    </>}
    {finding && <div className="decision-editor"><label>Decision reason<textarea value={rationale} onChange={event => setRationale(event.target.value)} placeholder="Why include, defer, or exclude this finding?" /></label>
      <div className="button-row">{(["include", "defer", "exclude"] as DecisionState[]).map(state => <button key={state} disabled={busy || !rationale.trim()} onClick={() => onDecision(state)}>{state}</button>)}</div></div>}
  </section>;
}
