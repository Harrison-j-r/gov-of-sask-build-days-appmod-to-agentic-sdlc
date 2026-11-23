# Change specification: Build Day lab guide canvas

## Metadata

- **Owner:** Repository maintainers
- **Status:** Approved for implementation
- **Source root:** Repository root, limited to the navigation paths below
- **Related issue:** Not created

## Problem and outcomes

### Problem

Participants navigate eight separate lab guides from the
[lab index](../labs/README.md). The index provides links and outcomes, but no
interactive step navigation or private resume state. The
[modernization lab](../labs/04-app-modernization/README.md) also requires
participants to follow one of two alternative application tracks.

### Desired outcomes

1. Provide a shared Copilot canvas for following Labs 00-07 in canonical order.
2. Help participants select one track, copy source-backed exercises, record
   self-reported progress, and resume privately across sessions.
3. Make the guide interactive and animated using GitHub-inspired styling,
   without executing exercises or weakening workshop safety boundaries.

### Success measures

- All eight labs have valid source targets and navigable participant steps.
- Saved progress survives provider reload and a new panel for the same
  repository, without leaking across repositories or tracks.
- All primary controls remain usable with keyboard input and reduced motion.

## Functional requirements

| ID | Requirement | Evidence or rationale |
| --- | --- | --- |
| FR-1 | Show Labs 00-07 in canonical order with clickable navigation. | [Lab index](../labs/README.md) |
| FR-2 | Support Java and .NET as alternative tracks, with appropriate shell commands and platform warnings. | [Readiness](../labs/00-readiness/README.md) |
| FR-3 | Show outcomes, numbered steps, expandable details, source links, working directories, and copyable prompts and commands. | Existing participant lab guides |
| FR-4 | Read exercise blocks from allowlisted source sections rather than maintaining independent command copies. | Prevent silent curriculum drift |
| FR-5 | Save selections, self-reported checklist state, and predefined blocker categories privately per repository and track. | Confirmed participant-guide scope |
| FR-6 | Restore state across sessions and panels; reject stale updates and require confirmation for reset. | Prevent lost progress |
| FR-7 | Offer an animated journey map, completion feedback, light/dark themes, reduced motion, and keyboard access. | Confirmed interactive-design scope |
| FR-8 | Provide safe read-only views of participant source material and links to existing capstone pathways. | [Capstone](../labs/07-capstone/README.md) |
| FR-9 | Expose repository discovery, project-install instructions, and a documented README launcher that prefills a safe opening prompt. | Direct request to make the guide accessible to repository users |

## Constraints and out of scope

### Constraints

- **Allowed paths:**
  - `.github/extensions/lab-journey/**`
  - `specs/lab-journey-canvas.md`
  - `labs/README.md`
  - `README.md`, limited to the guide launch/setup entry point
- **Primary validation command:** From repository root:
  `node --test .github\extensions\lab-journey\tests\lab-journey.test.mjs`
- **Compatibility:** Existing lab documents remain authoritative and usable
  without the canvas. Neither imported application changes.
- **Dependencies:** Scaffold through the extension tooling. Use an
  `extension.mjs` entry point and the runtime-resolved Copilot SDK; do not add
  a package installation for that SDK.
- **Data and security:** Store only selections, predefined blocker categories,
  and checklist state. No participant names, freeform notes, pasted logs,
  credentials, tenant identifiers, analytics, or external state synchronization.
- **Storage:** Use
  `$COPILOT_HOME/extensions/lab-journey/artifacts/`, defaulting to
  `~/.copilot/extensions/lab-journey/artifacts/`. Version state and key it by
  stable repository identity plus track, never by transient panel ID.
- **Runtime:** Bind HTTP to `127.0.0.1` on an OS-assigned port. Protect mutation
  routes with per-instance authorization, origin checks, payload limits, input
  validation, and stale-write detection.
- **Brand:** Follow the GitHub Brand Toolkit's
  [color](https://brand.github.com/foundations/color),
  [typography](https://brand.github.com/foundations/typography), and
  [logo](https://brand.github.com/foundations/logo) guidance. Use GitHub Green
  as an accent with accessible neutral surfaces and documented app tokens.
  A permitted unmodified logo may identify the integration secondarily;
  otherwise use a text GitHub link. Never imply endorsement or modify a logo.

### Exclusions

- No command execution, Copilot message sending, authentication, GitHub writes,
  workflow dispatch, deployment, or automated validation of participant work.
- No application changes, lab rewriting, facilitator solution browser,
  identity collection, telemetry, certificates, scoring, or AI tutor.
- No existing CI edits, generated workflow-lock changes, dependency upgrades,
  or cloud synchronization.
- Reading both track documents supports navigation only; it does not authorize
  modernization of either track.

## Edge cases

| Type | Condition | Expected behavior |
| --- | --- | --- |
| Normal | Participant selects a lab or copies an exercise | Correct source-backed step and exact displayed block |
| Failure | Clipboard access is denied | Visible error and manually selectable content |
| Failure | Source section is missing or changed | Actionable content error, not empty success |
| Failure | State is corrupt or unwritable | Explicit error; preserve existing data |
| Boundary | Two panels update the same progress | Shared state; stale update rejected |
| Boundary | Participant confirms reset | Reset only the selected repository and track |
| Compatibility | .NET selected outside Windows | Explain classic baseline limitation; do not imply support |
| Compatibility | Motion preference or app theme changes | Accessible static/light/dark presentation |

## Acceptance criteria

### AC-1: Complete source-backed navigation

- **Given** a checkout of this repository or its workshop fork,
- **When** the canvas opens and a participant selects any lab,
- **Then** exactly Labs 00-07 appear in canonical order with valid source
  targets, outcomes, steps, and completion criteria.
- **Verification:** Catalog/source integrity tests and runtime open checks.

### AC-2: Track and shell behavior

- **Given** Java or .NET and a command shell selection,
- **When** readiness or modernization guidance is displayed,
- **Then** the selected track's sources and documented command variants appear;
  the classic .NET Windows restriction remains visible where applicable.
- **Verification:** Track-selection tests and browser interaction checks.

### AC-3: Copy-only exercises

- **Given** a displayed source-backed prompt or command,
- **When** the participant activates Copy,
- **Then** the clipboard receives that exact displayed text with placeholders
  intact; its working directory and shell remain visible. Denied clipboard
  access produces visible failure and allows manual selection.
- **Verification:** Source-block tests and browser copy/error checks. Review
  endpoints/actions to prove no execution or external mutation is reachable.

### AC-4: Durable private progress

- **Given** self-reported step progress for one repository and track,
- **When** the provider reloads or a new panel/session opens,
- **Then** that progress is restored, while another repository or track does
  not inherit it.
- **Verification:** Synthetic persistence/isolation tests and runtime reload
  plus second-panel checks.

### AC-5: Consistent and recoverable state

- **Given** concurrent panels, invalid input, corrupt state, or a denied write,
- **When** state is read or changed,
- **Then** updates are atomic, stale mutations are rejected, errors are explicit,
  and existing data is not silently overwritten. Reset requires confirmation.
- **Verification:** Storage/concurrency tests and authorized HTTP route tests.

### AC-6: Accessible interaction and motion

- **Given** narrow or wide panels, either theme, and keyboard-only input,
- **When** the participant navigates and changes progress,
- **Then** primary controls have labels and visible focus, statuses are
  understandable without animation, and reduced-motion or motion-off mode
  removes animation.
- **Verification:** Browser checks for keyboard use, responsive layout, themes,
  motion, and readable contrast.

### AC-7: Workshop boundaries

- **Given** any guided lab,
- **When** its steps or completion state are displayed,
- **Then** self-reported ticks do not claim passing tests, approval, or CI.
  Human review, the known Java baseline defect, deterministic CI authority,
  pinned gh-aw tooling, optional live/cloud paths, and cleanup remain explicit.
- **Verification:** Catalog assertions against canonical source sections and
  participant guide review.

### AC-8: SDK lifecycle and safe content

- **Given** a loaded extension,
- **When** discovery, open, actions, reload, invalid input, reserved actions,
  or instance cleanup occur,
- **Then** runtime routing works, invalid inputs are rejected, saved state
  rehydrates, and closed instances release their servers and connections.
  Source content cannot execute raw HTML or access arbitrary files.
- **Verification:** Node HTTP/rendering/lifecycle tests and installed-runtime
  capability/open/action/error checks.

### AC-9: Repository access and launch

- **Given** a full workshop checkout or a project installation of the extension,
- **When** the user follows the README launch/setup entry point,
- **Then** the guide's complete assets and sharing manifest are present, the
  launcher targets this repository in interactive mode with a copy-only
  canvas-opening prompt, and manual instructions support existing sessions
  and forks without exposing private session IDs or local server URLs.
- **Verification:** Package/manifest checks, launcher decoding assertions, and
  local documentation link checks. Browser-to-app confirmation remains a
  user-controlled handoff, not automatic execution.

## Non-functional requirements

| ID | Quality | Testable requirement | Verification |
| --- | --- | --- | --- |
| NFR-1 | Reliability | Atomic state writes and stale-update rejection preserve saved progress. | Storage tests |
| NFR-2 | Privacy | No participant identity, secrets, freeform logs, analytics, or external synchronization. | State-schema and route review |
| NFR-3 | Security | Allowlisted reads, escaped content, safe links, authorized mutations, and bounded requests. | HTTP/rendering tests |
| NFR-4 | Accessibility | Keyboard controls, visible focus, labeled statuses, themes, and motion opt-out. | Browser checks |

## Assumptions, dependencies, and risks

| Item | Type | Validation or mitigation |
| --- | --- | --- |
| Participants use a canvas-capable GitHub Copilot runtime. | Dependency | Verify installed SDK discovery/open/action support |
| Node is available for deterministic tests. | Dependency | `node --version` observed `v26.13.0` during planning |
| Lab sections may change later. | Risk | Validate catalog targets and fail visibly on missing sections |
| Multiple panels or provider processes may write state. | Risk | Atomic writes, serialization, and revision checks |
| Brand assets require permitted use. | Risk | Text integration link if permission is unclear |

## Plan-mode review checkpoint

### Evidence

- **Current behavior:** [Lab index](../labs/README.md) lists the eight labs;
  [Lab 04](../labs/04-app-modernization/README.md) separates track guidance.
- **Existing tests:** No canvas extension or canvas tests existed in this
  checkout during planning.
- **Baseline validation evidence:** `git status --short` returned no changes
  before specification preparation. Installed SDK extension documentation and
  `canvas.d.ts` were read. Runtime behavior has not yet been tested.

### Unresolved questions

None affecting the approved plan's scope.

### Boundary and validation review

- [x] Evidence citations were checked against the repository.
- [x] Allowed paths cover anticipated implementation and tests only.
- [x] Primary validation is safe, non-interactive, and runnable from the root.
- [x] Acceptance criteria cover normal, failure, boundary, and compatibility cases.
- [x] Exclusions prevent application changes and autonomous lab execution.

Supplemental checks: `git diff --check`, `node --check` for changed modules,
and the documented offline Markdown link gate when available. Report missing
tools or unperformed UI checks explicitly. Do not run imported application
suites or regenerate unrelated gh-aw locks. CI remains merge authority.

### Stop conditions

Stop for conflicting repository evidence, unresolved human decisions, scope
escape, missing SDK/tool/storage prerequisites, failed validation caused by
this change, unclear asset permission, or a need for secrets, external writes,
destructive actions, or excluded paths. Do not replace failed checks with
success-shaped defaults or self-reported completion.

### Human approval

- **Approval basis:** After the committed specification was presented for
  approval, the requesting user instructed the agent to stop planning and start
  implementing. This instruction is treated as specification approval and
  implementation authorization; it does not claim a separate signed review.
- **Reviewer:** Requesting repository user
- **Approval date:** 2026-11-22
- **Approved specification commit:** `59e196a678a3f3b76fede8cc2607694f38c9a608`

The initial drafting-plan approval authorized only specification preparation.
The subsequent instruction to implement authorizes the bounded extension work.
The later direct request for repository installation/access and a README
opening link authorizes the launch/setup documentation and sharing manifest.
