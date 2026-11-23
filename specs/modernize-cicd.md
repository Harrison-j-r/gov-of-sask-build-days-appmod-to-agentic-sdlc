# Change specification: Modernize CI/CD

## Metadata

- **Owner:** Repository maintainers
- **Status:** Implementation authorized in the planning session
- **Source root:** Repository root; explicit cross-cutting automation exception
- **Related issue:** Not created

## Problem and outcomes

### Problem

Lab 04 documents interactive assessment and reviewed upgrades, but the
repository has no scheduled Modernize assessment or approved-plan CI executor.
The existing Java CI deliberately characterizes a known upstream test failure;
the .NET CI builds only the classic Framework 4.8 application. Neither gate can
be treated as successful validation of its modernized counterpart.

### Desired outcomes

1. Independent weekly Java and .NET assessment runs after maintainer setup.
2. Bounded GH-AW report triage without automatic implementation activation.
3. Manual execution of exact, human-reviewed plans, producing one draft PR
   only after deterministic target validation.

### Success measures

- Failed or missing evidence never becomes a successful assessment or PR.
- One track's failure does not suppress the other track.
- Unchanged baselines retain their existing validation behavior.
- Upgrade PRs receive ordinary CI for their published head SHA.

## Functional requirements

| ID | Requirement | Evidence or rationale |
| --- | --- | --- |
| FR-1 | Assess only Java Asset Manager or BookCatalog, with separate scheduled/manual entry points. | [Source roots](../AGENTS.md) |
| FR-2 | Publish curated reports with run, source-tree, configuration, and tool provenance. Reject source edits during assessment. | Assessment evidence must be distinguishable from a successful upgrade. |
| FR-3 | GH-AW consumes only successful, trusted assessment runs and creates at most one advisory issue or no-ops. Suppress duplicates and never add `agent-ready`. | [Workflow boundary](../.github/workflows/README.md) |
| FR-4 | Upgrade inputs identify a reviewed plan bundle and merged approval PR, not executable commands or free-form prompts. | [Specification contract](README.md) |
| FR-5 | Verify authorized human review, exact specification/plan content, allowed paths, fixed target, and application-tree freshness. | Markdown claiming approval is not GitHub review evidence. |
| FR-6 | Execute the selected plan locally on an isolated checkout. Check committed and uncommitted changes against the approved boundary. | Modernize can commit its changes. |
| FR-7 | Publish through a separate fine-grained PAT job that never executes candidate code. | Default Actions-token PRs do not reliably start ordinary PR CI. |
| FR-8 | Preserve legacy gates and add fixed Java 21/Spring Boot 3 and .NET 10 target gates. | [Java CI](../.github/workflows/ci-legacy-java.yml), [.NET CI](../.github/workflows/ci-legacy-dotnet.yml) |

## Constraints and out of scope

### Constraints

- **Allowed paths:** This specification; `scripts/modernization/**`; directly
  related target validators under `scripts/validation/**`; the four new
  `modernize-assess-*`/`modernize-upgrade-*` workflow entry points; the new
  `modernize-triage.md` and compiler-generated lock; the two legacy CI
  workflows; scripts/workflows CI; directly related README and Lab 04-06
  documentation.
- **Primary validation command:** From the repository root,
  `pwsh -NoProfile -File scripts/modernization/tests/Test-Modernization.ps1`.
- **Compatibility:** Preserve imported source, provenance, baseline wrapper
  behavior, existing GH-AW workflows, and the interactive Upgrade-agent route.
- **Dependencies:** Keep GH-AW v0.89.21 and existing action pins. Verify the
  Modernize release and report/plan contracts rather than guessing them.
- **Data and security:** Use synthetic fixtures. Separate inference, report
  triage, and publication credentials. Do not upload raw model transcripts or
  complete home-directory logs. No secrets in repository files.

### Exclusions

- No application modernization, capstone changes, or Azure operations in this
  infrastructure change.
- No automatic plan approval, upgrades from issue labels, auto-merge,
  self-approval, forced branch overwrite, or skipped CI.
- No live workflow runs, credential configuration, or schedule activation
  without separate authorization and real approved application plans.
- No invented assessment reports or pre-approved upgrade examples.
- No simultaneous CI and Copilot app execution of one modernization plan.

## Edge cases

| Type | Condition | Expected behavior |
| --- | --- | --- |
| Normal | Valid assessment for either configured track | Publish actual report evidence; do not change source. |
| Failure | Missing credential/tool/report or failed validation | Fail explicitly and do not publish an upgrade PR. |
| Boundary | Untrusted run, stale plan, traversal, protected-path edit, or modified approval input | Reject before agent execution or publication. |
| Compatibility | Legacy Java defect or .NET build-only baseline | Preserve the documented baseline outcome; never apply its exception to a target profile. |
| Retry | Same plan/source already has an open PR | Return that PR instead of rerunning or overwriting it. |

## Acceptance criteria

### AC-1: Independent assessments and bounded triage

- **Given** completed setup and either selected source,
- **When** its weekly or manual assessment completes,
- **Then** source is unchanged and a provenance-bearing report is available.
  Only trusted successful reports reach GH-AW; empty/duplicate evidence
  produces no new issue.
- **Verification:** Synthetic runner/artifact fixtures and separately
  authorized live assessment pilots.

### AC-2: Reviewed-plan execution and isolated publication

- **Given** a merged human-reviewed specification and exact technical plan,
- **When** a maintainer dispatches the matching track workflow,
- **Then** stale/unsafe input is rejected, the full delta remains in scope,
  target checks pass, and an isolated publisher creates at most one draft PR.
- **Verification:** Approval, source-hash, Git-delta, credential-boundary, and
  publication fixtures; an authorized pilot confirms CI on the actual PR SHA.

### AC-3: Meaningful deterministic gates

- **Given** a supported baseline or target project profile,
- **When** CI runs,
- **Then** it selects the appropriate fixed commands and fails for unsupported
  profiles, missing required jobs, or missing behavior evidence.
- **Verification:** Profile fixtures, target validator tests, and existing
  baseline checks. Java target requires full reactor verification; .NET
  target requires local CRUD/validation/restart-persistence smoke checks.

## Non-functional requirements

| ID | Quality | Testable requirement | Verification |
| --- | --- | --- | --- |
| NFR-1 | Reliability | Failure of one track does not cancel the other; no hidden retry loop. | Independent entry points and failure fixtures. |
| NFR-2 | Security | Publication credentials are absent from agent/build jobs; archives and complete Git deltas have enforced boundaries. | Credential-placement, traversal, committed-edit, and patch fixtures. |
| NFR-3 | Maintainability | Thin workflows share helpers; new GH-AW output is reproducible with the pinned compiler. | Focused tests, lint, and second-compile comparison. |

## Assumptions, dependencies, and risks

- Real application specifications and plan bundles are later operator inputs.
- CLI flags do not prove unattended runtime behavior; validate the pinned
  release and actual output contract before enabling it.
- Release URLs and SHA-256 digests are required, reviewed setup inputs, with
  no guessed defaults. Offline implementation/tests can proceed while release
  authorization is unavailable; installation and live activation remain
  blocked until those inputs are verified.
- The .NET target needs Windows web/LocalDB tooling and disposable synthetic
  data. A missing prerequisite cannot be replaced with a build-only pass.
- GH-AW safe outputs do not sandbox ordinary Actions jobs or preprocessing.
- Setup explicitly authorizes recurring assessment/triage costs; it does not
  authorize future application upgrades.

## Plan-mode review checkpoint

### Evidence

- Source/CI/lab guidance was inspected while preparing the session plan.
- Modernize 1.0.95 and GH-AW v0.89.21 help/version information was inspected.
- Application builds and live modernization were not run during planning.
- Implementation validation results must be recorded from actual commands.

### Unresolved questions

None affecting the agreed feature boundary. Availability of release artifacts,
supported credentials, runner tools, and real plan inputs remains a preflight
requirement rather than permission to invent replacements.

### Boundary and validation review

The approved session plan supplies the detailed implementation boundary and
test cases. This repository-wide automation specification must not be supplied
to the existing single-application `spec-to-backlog` workflow.

### Stop conditions

Stop for incompatible pinned tooling, missing required permissions or tools,
unreviewed source changes, unsafe credentials/publication, incomplete evidence,
or any need to weaken checks or expand this boundary.

### Human approval

The user explicitly requested execution of the reviewed session plan:
"please now execute the plan"; the plan-mode approval subsequently authorized
implementation. This records that session authorization only. It is not
approval of either application's modernization plan or of live GitHub/cloud
operations, and it must not be accepted as a machine-executable upgrade
approval.
