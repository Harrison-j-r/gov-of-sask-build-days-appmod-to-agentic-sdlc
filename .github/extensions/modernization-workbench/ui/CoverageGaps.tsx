import type { Assessment, GapAction, GapCard } from "./model";

export function CoverageGaps({ assessment, cards, onAction }: {
  assessment: Assessment; cards: GapCard[]; onAction: (action: GapAction, gap: GapCard) => void;
}) {
  const reported = assessment.coverage.filter(item => item.state === "reported").length;
  const missing = assessment.coverage.length - reported;
  return <section className="card coverage-next">
    <div className="section-heading"><div><h2>Assessment coverage</h2><p>Understand the gaps, then choose a safe next step.</p></div><span className="badge">{missing} areas need evidence or review</span></div>
    <div className="coverage-summary"><span><strong>{reported}</strong> native domains declared</span><span><strong>{assessment.insights.length}</strong> native fact documents supplied</span><span>Unknown is not passed.</span></div>
    <div className="reported-domains">{assessment.coverage.filter(item => item.state === "reported").map(item => <span key={item.name} className="badge">{item.name}: reported</span>)}</div>
    {cards.map(card => <details className="gap-card" key={card.id}>
      <summary><strong>{card.title}</strong><span className="badge">{card.status}</span></summary>
      <p>{card.detail}</p><p className="hint">{card.impact}</p>
      <div className="gap-evidence"><span className="eyebrow">EVIDENCE FOR THIS STATUS</span><p>{card.evidence}</p></div>
      <div className="button-row">{card.actions.map(action => <button key={action.kind} disabled={!action.enabled} title={action.reason || undefined} onClick={() => onAction(action, card)}>{action.label}</button>)}</div>
      {card.actions.filter(action => !action.enabled).map(action => <p key={action.kind} className="hint">{action.reason}</p>)}
    </details>)}
    <p className="hint">Import a complete bundle containing the same app's report.json and facts folder. It creates a separate assessment; viewing documents never changes native coverage or proves that an analysis passed.</p>
  </section>;
}
