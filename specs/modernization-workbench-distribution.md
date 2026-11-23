# Modernization workbench: repository distribution

## Metadata

- **Status:** Implementation contract; PR review pending.
- **Source root:** `.github/extensions/modernization-workbench/`.
- **Scope:** Publish the existing canvas as repository-shared source, preserving
  its current feature and permission boundaries.
- **Related issue:** None; requested directly in the implementation session.

## Problem and outcomes

The repository already distributes a navigation-only canvas at
[`lab-journey`](../.github/extensions/lab-journey/README.md), but the modernization
review canvas previously existed only as a personal installation. Participants
need reproducible source, setup steps, synthetic examples, and clear limitations
without inheriting another user's assessments or environment.

The shared package provides guided app-candidate selection, source-linked
evidence review, actionable coverage gaps, contextual chat, decisions, and
review-only handoffs. It is not a new modernization engine or completion of
the gated .NET/native-planning integrations.

## Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Discover a `project:modernization-workbench` canvas from the repository's extension source. |
| FR-2 | Install pinned dependencies from the public npm registry and build the renderer locally. |
| FR-3 | Report missing setup before loading the assessment controller; never install/build automatically. |
| FR-4 | Retain private artifacts under the user's Copilot home, not under the repository extension. |
| FR-5 | Preserve existing Java report review, guided start, coverage actions, source-preview approval/provenance, decisions, and handoff gates. |
| FR-6 | Document supported schemas, Windows-first validation, native-tool limitations, and explicit project/user provider selection. |

## Constraints and allowed paths

- `.github/extensions/modernization-workbench/**`: source, schemas, tests,
  synthetic fixtures, manifest, package metadata/lockfile, and local ignore rules.
- `README.md`: a short participant-facing setup/discovery entry.
- `specs/modernization-workbench-distribution.md`: this distribution contract.
- No application, capstone, workflow, generated workflow lock, or existing
  extension changes.
- Preserve the [repository modernization sequence](../labs/04-app-modernization/README.md):
  approved application specification, assessment, reviewed technical plan, then
  separately approved Upgrade execution.
- Do not commit generated frontend output, dependencies, caches, personal
  artifacts, real assessments, source snapshots, logs, screenshots, credentials,
  internal registry URLs, or user-specific paths.
- Do not publish copies of installed Microsoft extension code or bundled
  third-party package implementations.

## Setup and validation

From the repository root on Windows, with Node.js 22.12 or later and npm:

```powershell
npm --prefix .github\extensions\modernization-workbench ci
npm --prefix .github\extensions\modernization-workbench run validate
git diff --check
actionlint -color
```

`validate` runs type checks, core/improvement/distribution tests, a local
production build, and the synthetic Edge browser gate. It does not run hosted
AI or live assessments. The existing deterministic repository CI remains merge
authority; PR evidence records actual local outcomes.

For participant setup without running tests, use the
[extension installation instructions](../.github/extensions/modernization-workbench/README.md#install-and-open).

## Acceptance criteria

| ID | Given / when / then | Verification |
| --- | --- | --- |
| AC-1 | Given a source-only checkout, when discovery runs, then the canvas is declared; opening before install/build returns actionable prerequisites without running them. | Setup tests and runtime discovery/open check before dependency restoration. |
| AC-2 | Given the documented setup commands, when dependencies and assets are built, then the project provider opens and serves the existing canvas. | Fresh repository restore, build, and native open/actions. |
| AC-3 | Given an existing personal installation, when the project provider opens, then its private storage identity is preserved and no state is copied into Git. | Artifact-root tests, explicit provider selection, staged-path review. |
| AC-4 | Given the distributable package, when its lockfile and fixtures are inspected, then dependency URLs are public and fixtures contain synthetic app data without personal source paths. | Distribution tests and staged-content review. |
| AC-5 | Given imported evidence and synthetic source, when the existing review flows run, then permissions, provenance, decisions, chat correlation, and coverage gaps retain their previous behavior. | Core, improvement, and real-browser tests. |
| AC-6 | Given the finished PR, then only the allowed source/documentation paths are changed; generated and private content remain excluded. | Git status, ignore checks, staged diff, and PR file list. |

## Edge cases and exclusions

- Missing or mismatched local dependencies and incomplete renderer assets produce
  an explicit setup error, not empty success or background installation.
- Two providers may be registered when a user copy exists. Select
  `project:modernization-workbench` rather than deleting the personal copy.
- Recorded NuGet/SDK failures remain labeled as authoring observations; sharing
  the package does not prove that the user's native environment has been checked.
- .NET assessment/import, native technical-plan creation, deployment, automatic
  upgrades, and GitHub writes from the canvas remain outside this release.
- Unsupported native reports, invalid source bindings, unavailable permissions,
  and stale records retain their existing safe failure behavior.
- Build output is local and reproducible, not committed. Pulling source or
  dependency changes requires reinstalling/building and reloading the extension.

## Stop conditions

Stop for unexpected conflicting repository edits, unavailable required tools,
dependencies or publication permission, failing checks caused by the packaging,
private content in the proposed commit, or any required change outside the
allowed paths. Do not weaken TLS, authentication, native approval, or CI to
complete publication.
