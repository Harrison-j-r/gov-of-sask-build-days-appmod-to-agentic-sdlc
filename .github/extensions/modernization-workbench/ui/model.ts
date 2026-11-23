export type DecisionState = "include" | "defer" | "exclude";
export type CoverageState = "reported" | "not_assessed" | "unknown";

export interface Evidence {
  id: string;
  title: string;
  artifact: string;
  locator: string;
  text: string;
  sourcePath?: string;
  line?: number;
  projectPath?: string;
}

export interface Component {
  id: string;
  name: string;
  kind: string;
  detail: string;
  evidenceIds: string[];
}

export interface Relationship {
  id: string;
  source: string;
  target: string;
  label: string;
  evidenceIds: string[];
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  priority: string;
  recommendation: string;
  componentIds: string[];
  evidenceIds: string[];
  fingerprint: string;
  targets?: string[];
}

export interface Insight {
  id: string;
  title: string;
  body: string;
  method: string;
  evidenceIds: string[];
}

export interface Assessment {
  id: string;
  name: string;
  language: string;
  toolVersion: string;
  importedAt: string;
  contentDigest: string;
  sourceStatus: string;
  sourceLabel: string;
  coverage: { name: string; state: CoverageState; detail: string }[];
  components: Component[];
  relationships: Relationship[];
  findings: Finding[];
  insights: Insight[];
  evidence: Evidence[];
  warnings: string[];
  source?: { root: string; runRoot: string; relativePath: string; files: { path: string; digest: string }[] } | null;
}

export interface Decision {
  assessmentId: string;
  findingId: string;
  state: DecisionState;
  rationale: string;
}

export interface Thread {
  id: string;
  assessmentId: string;
  entityId: string | null;
  question: string;
  status: string;
  responses: { messageId: string; content: string }[];
  error?: string;
}

export interface Job {
  id: string;
  name: string;
  kind: string;
  status: string;
  message: string;
}

export interface Handoff {
  id: string;
  assessmentId: string;
  status: string;
  body: string;
  digest: string;
  gaps: string[];
}

export interface WorkbenchState {
  revision: number;
  workspace: { name: string; path: string };
  capabilities: { approvals: boolean; nativeRuns: boolean; nativePlans: boolean; reasons: string[] };
  assessments: Assessment[];
  decisions: Decision[];
  threads: Thread[];
  jobs: Job[];
  handoffs: Handoff[];
  reviewContexts: ReviewContext[];
  sourceBindings: SourceBinding[];
  activeReviewContextId: string | null;
  readiness: ReadinessCard[];
  gaps: Record<string, GapCard[]>;
  sourceRelationships: Record<string, string>;
}

export interface AppCandidate {
  id: string;
  name: string;
  relativePath: string;
  language: "java" | "dotnet";
  manifests: string[];
}

export interface Discovery {
  candidates: AppCandidate[];
  warnings: string[];
  partial: boolean;
  visited: number;
  relativeRoot: string;
}

export interface ReviewContext {
  id: string;
  app: AppCandidate;
  goal: string;
  notes: string;
  savedAt: string;
}

export interface SourceBinding {
  id: string;
  assessmentId: string;
  contextId: string;
  appId: string;
  relativePath: string;
  language: string;
  provenance: "user-linked-current";
  revision: number;
}

export interface ReadinessCard {
  id: string;
  title: string;
  status: string;
  detail: string;
  observation: string;
  observedAt: string | null;
}

export type GapActionKind = "import_report" | "import_folder" | "start" | "setup" | "prepare_full" | "draft_question";
export interface GapAction { kind: GapActionKind; label: string; enabled: boolean; reason: string; }
export interface GapCard {
  id: string;
  title: string;
  status: string;
  reason: string;
  detail: string;
  impact: string;
  evidence: string;
  actions: GapAction[];
}

export interface SourcePreview {
  status: string;
  message: string;
  kind?: "snapshot_matched" | "current_unverified" | "current_matches_snapshot";
  lines: { number: number; text: string; highlighted: boolean }[];
  candidates?: string[];
  fileLabel?: string;
  digest?: string;
  mapping?: string;
  reportedLine?: number | null;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  truncated?: boolean;
  navigation?: boolean;
}
export interface Selection {
  kind: "finding" | "component" | "insight";
  id: string;
}

export function breakdown(findings: Finding[], field: "category" | "severity" | "priority") {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const name = finding[field] || "Unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function compareAssessments(before: Assessment, after: Assessment) {
  const old = new Map(before.findings.map(finding => [finding.fingerprint, finding]));
  const next = new Map(after.findings.map(finding => [finding.fingerprint, finding]));
  return {
    added: after.findings.filter(finding => !old.has(finding.fingerprint)),
    notObserved: before.findings.filter(finding => !next.has(finding.fingerprint)),
    shared: after.findings.filter(finding => old.has(finding.fingerprint)),
  };
}
