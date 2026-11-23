# Modernization Assessment Workbench

A repository-shared GitHub Copilot canvas for evidence-linked modernization
review. This Windows-first preview includes Java report review and app-candidate
discovery for Java and .NET. It is not a complete Java/.NET modernization engine.

The canvas complements the [Lab 04 workflow](../../../labs/04-app-modernization/README.md):
approved specification, assessment, reviewed technical plan, then separately
approved Upgrade work. It does not replace that sequence or deterministic CI.

## Available now

- A guided Start panel with explicit, bounded Java/.NET app-candidate discovery,
  saved review goals, and readiness that distinguishes current host capability
  from recorded native-tool failures.
- Actionable evidence gaps that open an importer, setup/source context, or a
  draft question without launching analysis or manufacturing completed checks.
- An evidence-first inspector with readable guidance, referenced components,
  and separate hash-matched snapshots or approved current-source previews.
- Import a verified Modernize 1.0.0 Java AppCAT report, with optional native
  `facts` documents. Original report text and normalized evidence are retained
  separately. No model runs when a report is imported or viewed.
- Explore an interactive project/source map, coverage matrix, native finding
  priorities, category charts, a component heatmap, and searchable/paged
  finding locations. Unavailable facts and checks remain explicitly unknown.
- Compare assessment fingerprints without calling missing findings resolved.
- Record include/defer/exclude decisions with reasons and revision checks.
- Discuss selected evidence in the current Copilot session. Only correlated
  ordinary responses appear in the canvas; unrelated messages and reasoning
  content are not copied.
- Prepare a review-only handoff packet. Native confirmation is required before
  sending it to Copilot; sending never activates Upgrade or authorizes changes.
- Request a bounded Java assessment through native confirmation, source-policy
  checks, an isolated working copy, and the native session's shell lifecycle.

## Supported scope and known limitations

The .NET and native-plan portions are deliberately gated, not replaced with
invented reports or apparently successful fallback output:

1. **Java reports:** the adapter supports the tested AppCAT/Modernize schema
   `1.0.0`. Native run profiles are restricted to Modernize `1.0.95`; other
   versions require compatibility validation. Unsupported reports fail visibly.
2. **.NET:** candidate discovery is available, but native assessment and .NET
   report import remain disabled. Authoring checks could not install AppCAT
   because of NuGet service-index/TLS failures.
3. **Native technical planning:** creation remains disabled. Authoring checks
   using Modernize `1.0.95` and Copilot CLI `1.0.83` failed with
   `extensionSdkPath is required when standalone extensions are requested`.
   Review-only handoff packets are available; they are not native executable plans.
4. **Full-analysis facts:** a Full-mode report may lack fact documents or a
   topology graph. The canvas shows these gaps rather than inventing architecture,
   business flows, dependencies, or a data model.

The recorded blockers are compatibility observations from authoring, not a
fresh diagnosis of a participant's environment. Opening the canvas does not
recheck or repair native tools, networking, credentials, or organization policy.

## Install and open

The shared source is in `.github/extensions/modernization-workbench/`. Fork or
clone the full repository and open its checkout in a canvas-capable GitHub
Copilot app. Use Windows, Node.js **22.12 or later**, and npm. Microsoft Edge
is needed for the browser validation gate, not to install dependencies.

From the repository root, build this extension locally:

```powershell
npm --prefix .github\extensions\modernization-workbench ci
npm --prefix .github\extensions\modernization-workbench run build
```

The checked-in lockfile and package-local npm configuration use the public npm
registry. The runtime supplies `@github/copilot-sdk`; do not install it as a
package. Dependencies and generated `public` assets are intentionally not
committed. No install or build runs automatically when the extension loads.
Repeat the two commands after pulling dependency or UI changes.

Start a new Copilot session, or ask it to reload extensions, then ask:

```text
Open this repository's Modernization workbench canvas using
extensionId project:modernization-workbench and canvasId modernization-workbench.
Do not run an assessment.
```

Approve repository trust or extension permissions only through the app if
requested. The project copy does not require the author's personal installation.
If you also installed a personal copy, keep it: runtimes may expose both
providers. Select `project:modernization-workbench` explicitly to avoid ambiguity.
The canvas instance is only a panel handle, not the saved-data identity.

Before local setup, opening returns `workbench_setup_required` with the commands
to run. Missing, mismatched, or incomplete dependencies/assets are not hidden by
an empty report. The `get_setup` action inspects local prerequisites only.
After setup, `get_state` reads a compact assessment summary.

Modernize CLI and its normal authentication are needed only for a separately
approved native run. To explore without a native run, copy
`tests\native-java-full.json` to a file named `report.json` in a temporary folder,
then import that file. The adapter expects the native report filename. These
fixtures are synthetic examples, not workshop-app assessments.

### Optional user-level installation

To reuse the canvas outside this repository, copy only this extension's source,
schemas, UI, package files, and tests to
`$COPILOT_HOME\extensions\modernization-workbench\` (default
`~\.copilot\extensions\modernization-workbench\`), then run `npm ci` and
`npm run build` in that folder and reload extensions. Never copy `artifacts`,
`node_modules`, `.cache`, or native run folders between users or repositories.
User scope is optional; the repository setup above is the workshop path.

## Review a report

Use **Import report** for a single application's `report.json`.
Use **Import folder** for that application's report directory so `facts`
paths are preserved. Only JSON, Markdown, and HTML report documents are
ingested; executable assets are excluded. HTML is preserved as inert data,
never embedded or executed. Select one application's folder, not a portfolio.
Imports are bounded to 128 documents, 25 MiB per document, and 30 MiB total.
Normalization additionally limits projects, finding locations, components, and
expanded evidence; a limit failure never imports a truncated assessment.

Counts describe finding locations, not unique rules. Native mandatory/optional
priority is not converted into a fabricated security-severity score.
The map's source-reference edges are inventory relationships, not observed
runtime calls.

## Guided review and source previews

Use **Start / app context** to find build-root candidates in the current
workspace. Discovery reads manifest metadata only, skips generated/vendor
directories and links, and reports any search limit or policy restriction.
It is bounded to 10,000 visited entries, depth 12, and 200 candidates.
An app candidate is not automatically a verified application boundary.

Save a review goal and notes, then optionally link the selected report to an
app's current source. The link remains explicitly unverified against the
assessment. It neither changes the native findings nor grants permission to
read files. Review goals do not configure native CLI target versions.

Coverage gaps offer safe next steps. **Draft a question** only fills the chat
composer; sending is separate. **Prepare Full-analysis request** only fills
the existing request form. Setup details do not recheck networks, install
tools, change authentication, or enable the blocked .NET/planning paths.
Imported narrative availability is kept separate from native assessment coverage.

In the inspector, **Guidance** comes first; **Raw evidence** retains the original
report document/JSON. The **Code** tab reads no file until you request a preview:

- Current files require native confirmation and successful source-policy checks.
  They are labeled as current, unverified against historical assessment evidence.
- Snapshot previews require an owned run, an admitted file mapping, and a matching
  recorded hash. Hash matching verifies bytes, not the finding's correctness.
- Ambiguous locations require a mapping choice. Missing/expired snapshots,
  out-of-scope paths, invalid lines, denied access, and changed files remain
  explicit states; current files are never substituted silently.
- File reads stay within 2 MiB; excerpts are at most 120 lines and 32 KiB.
  Navigation-only previews are not presented as validated finding locations.

Preview content is transient in the inspector, is not live-watched, and is not
added to general state, logs, or Copilot questions. Request a fresh preview after
source changes. Current-source previews clear when the window regains focus,
without rereading files automatically. Selecting a finding, app, or gap performs
no model request.

Before requesting a live run, review the repository's own guidance and approved
application specification where required. Select a relative build-root path.
Only one run per app may be active or awaiting reconciliation. Full analysis
is blocked for detected database-connected inputs because live database work
is outside this extension's scope; use issue-only or an externally approved
report instead.

## State and boundaries

Private records and immutable native bundles always live under
`$COPILOT_HOME\extensions\modernization-workbench\artifacts\` (default
`~\.copilot\extensions\modernization-workbench\artifacts\`), including when the
code is installed in this repository. They are never written into the checked-in
extension folder. Data is keyed to the canonical local worktree path. Another
clone/worktree does not silently inherit approvals. A new canvas panel for the
same workspace reuses its state; an existing personal installation's records
are not copied, migrated, or reset by adding the project extension.

Temporary source copies and native job logs live in the owning session's
`files\modernization-workbench\runs\` directory. Native execution is attached
to the session, not to an iframe. A provider restart marks unsettled work as
unknown instead of rerunning it; reconcile the native command before retrying.

The server binds only to loopback. API requests require a per-panel token and
same-origin checks. No telemetry, CDN scripts, secret collection, Azure
deployment, GitHub writes, arbitrary shell endpoints, automatic retries, or
approval overrides are included.

Use it on a trusted local machine. Loopback binding and browser-origin checks
are not an operating-system isolation boundary against other local processes.

Local orchestration is not offline AI processing. Contextual questions and
approved assessments can use the normal hosted services and authentication
of Copilot and Modernize.

Stale writes fail visibly. Corrupt records are not reset. If a crashed writer
leaves an artifact lock, stop the owning provider and inspect the exact lock
before recovering it; never recursively clear the artifact directory.

## Development and validation

From the repository root, after installation:

```powershell
npm --prefix .github\extensions\modernization-workbench run validate
git diff --check
```

The validation script type-checks, runs focused Node tests, builds the renderer,
and drives installed Microsoft Edge through Playwright. Set
`WORKBENCH_BROWSER` to another installed Playwright channel if appropriate.
These tests use temporary storage, real native Java report fixtures, and a
synthetic SDK boundary. They do not run hosted AI or assess workshop sources.
Distribution tests cover the source-only checkout, setup prerequisites, public
dependency URLs, synthetic fixture provenance, and user-owned artifact paths.

The real-browser gate covers imports, linked evidence, decision persistence,
chat correlation, declined run/handoff confirmation, markup safety, narrow
layout, reduced motion, theme tokens, and 5,000 finding locations across 500
components. These passing tests do not establish the blocked .NET/planning
integrations or replace the remaining native runtime checks.

Windows atomic replacement retries transient sharing violations while retaining
the original file and revision checks. Persistent access failures still surface
as errors; neither the target file nor stale locks are deleted as a fallback.

Generated `public\` assets are built from `ui\`. Dependency versions are pinned
in the lockfile; package source/build prerequisites are checked before the
assessment controller is imported. Build output, dependency folders, caches,
test output, and private artifacts are ignored. Do not force-add them to Git.

The distribution contract is
[`specs/modernization-workbench-distribution.md`](../../../specs/modernization-workbench-distribution.md).
The implementation uses the repository's [MIT license](../../../LICENSE);
installed third-party packages retain their own licenses. It is workshop
material, not an official GitHub or Microsoft product or endorsement.
