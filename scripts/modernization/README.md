# Modernize CI/CD

These optional workflows connect the reviewed work in Lab 04 to GitHub Actions:

| Workflow | Purpose |
| --- | --- |
| [Java assessment](../../.github/workflows/modernize-assess-java.yml) | Weekly/manual assessment of Java Asset Manager on Linux. |
| [.NET assessment](../../.github/workflows/modernize-assess-dotnet.yml) | Weekly/manual assessment of BookCatalog on Windows. |
| [Report triage](../../.github/workflows/modernize-triage.md) | GH-AW proposes one advisory issue from a verified report, or no-ops. |
| [Java upgrade](../../.github/workflows/modernize-upgrade-java.yml) | Manually execute a reviewed Java 21/Spring Boot 3 plan. |
| [.NET upgrade](../../.github/workflows/modernize-upgrade-dotnet.yml) | Manually execute a reviewed .NET 10 ASP.NET Core/EF Core plan. |

The tracks have separate runs and concurrency groups. Assessment does not
change application source. Triage does not approve plans, apply `agent-ready`,
or start upgrades. Upgrade execution, deterministic validation, and PR
publication run in separate jobs.

## 1. Review and set up a disposable fork

Start in a GitHub.com workshop fork, not a production repository. This version
does not target GitHub Enterprise Server. Read the
[automation specification](../../specs/modernize-cicd.md), generated triage
lock, and [workflow guidance](../../.github/AGENTS.md).

Leave the repository variable `MODERNIZE_ENABLED` unset while preparing the
credentials, release pins, runner prerequisites, and required checks below.
Use `pilot` for separately authorized manual pilot runs; it does not enable
the schedules. Set it to `true` after successful setup to enable weekly
assessment and report triage. Any other value disables these workflows.
Recurring enablement is consent for assessment and GH-AW inference costs,
not approval of an application upgrade.

Local plan packaging and fixture checks require PowerShell 7.4 or later
(`pwsh`), not Windows PowerShell 5.1.

### Credentials

Create these repository secrets through GitHub's settings. Never put their
values in commands, issues, plans, or source files.

| Secret | Scope and use |
| --- | --- |
| `MODERNIZE_COPILOT_TOKEN` | The supported Modernize GitHub/Copilot inference credential, with only required inference and repository metadata access. Available only to the CLI execution step; no repository write permission. |
| `MODERNIZE_PUBLISH_TOKEN` | A separate fine-grained PAT for this fork, with Contents and Pull requests read/write. Available only to the trusted publisher step; never to the model or candidate build. |

GH-AW uses the existing short-lived `copilot-requests: write` mechanism, not
either PAT. Approval checks and CI observation use the workflow's read-only
GitHub token. If policy cannot supply these separated permissions, stop rather
than substitute a broader credential.

### Release pins

[config.json](config.json) fixes Modernize at `1.0.95`. Through an authorized
connection, verify the [official release](https://github.com/microsoft/modernize-cli/releases)
and its distribution digests, then set:

- `MODERNIZE_LINUX_URL` and `MODERNIZE_LINUX_SHA256`;
- `MODERNIZE_WINDOWS_URL` and `MODERNIZE_WINDOWS_SHA256`.

Each URL must identify an archive or MSI in that exact release under
`microsoft/modernize-cli`; each SHA-256 must be the independently reviewed
distribution digest (64 lowercase hexadecimal characters, without a `sha256:`
prefix). Select the x64 distributions for these hosted runners.
The installer verifies the digest before extraction and
checks the executable's version afterward. It has no `latest`, mutable
installation-script, alternate-credential, or missing-pin fallback. Prefer a
portable archive; Windows MSI support uses administrative extraction into the
job's temporary directory, not a machine-wide installation.

**Release artifacts and live Modernize runs have not been verified by the
offline fixture tests.** Missing authorization to read release metadata is a
setup blocker, not permission to invent URLs/digests or bypass SSO.

The checked-in [assessment configuration](assessment.yaml) deliberately uses
the pinned CLI's documented issue-only defaults. The configured Java/.NET
destinations are policy goals used by triage and enforced by upgrade gates;
they are not undocumented assessment flags. Review the real report during the
pilot to confirm the defaults and output format before recurring activation.

### Runner and merge gates

Java jobs require JDK 21 for assessment/target verification. The legacy Java
baseline still uses JDK 8. BookCatalog requires a Windows runner with Visual
Studio/MSBuild, Framework 4.8 tools, NuGet, the .NET 10 SDK, and LocalDB for its
target behavior checks. Missing LocalDB must not become a build-only pass.

Configure branch protection/rulesets to require:

- `Legacy Java validation` for Java changes;
- `Legacy .NET validation` for BookCatalog changes;
- the applicable existing deterministic repository checks.

These final status jobs enforce the selected baseline/target jobs, including
unexpectedly skipped jobs. Do not continue requiring only a conditionally
skipped legacy sub-job after modernization. Agent judgment is never a merge
gate override.

## 2. Run and inspect assessments

After an authorized pilot/setup, set `MODERNIZE_ENABLED=true`. Java assessment
is scheduled for Monday 06:17 UTC and .NET for Monday 06:43 UTC. GitHub schedules
are best effort; either workflow can also be run manually from the Actions
page on `main`. Disabling one workflow does not disable the other.

Each successful run uploads `assessment-java-<attempt>` or
`assessment-dotnet-<attempt>` with two files:

- `report.md`: actual Markdown reports produced by the CLI, combined within
  a size limit and screened for secret-like material;
- `manifest.json`: repository, source SHA/tree, run/attempt, workflow, desired
  target, CLI/model/configuration identity, and report digest.

The CLI's raw transcripts and home-directory logs are not uploaded. Missing,
empty, oversized, or unsafe reports fail explicitly. Scores and recommendations
do not prove successful modernization, secure code, or behavior preservation.

GH-AW accepts only the two named successful assessment workflows on the same
repository's default branch. It validates artifact provenance and current
source/configuration, limits context, and skips already represented source
fingerprints. It may create one `[modernize]` advisory issue with evidence and
proposed acceptance criteria. Review the issue; no implementation is activated.

## 3. Prepare an actual reviewed upgrade plan

Use the existing [Java](../../labs/04-app-modernization/java/README.md) or
[.NET](../../labs/04-app-modernization/dotnet/README.md) specification,
assessment, and technical-plan process. Choose either this CI executor or the
Copilot app Upgrade agent for a work item, never both concurrently.

The application specification must contain the exact metadata:

- `- **Status:** Approved`
- `- **Source root:**` followed by the selected source, optionally in backticks.

The fixed sources are `legacy-src/java-asset-manager` and
`legacy-src/dotnet-bookcatalog/shared-legacy-app`. Keep technical-plan paths
portable and repository-relative; remove local-machine paths and any tasks
outside the approved runtime/framework change. No cloud provisioning or
deployment is authorized by these workflows.

From the repository root, package the actual tool outputs. These are input
collection commands, not fabricated assessment or plan examples:

```powershell
$planDirectory = Read-Host 'Actual directory containing reviewed plan.md and tasks.json'
$planName = Read-Host 'Plan name using lowercase letters, numbers, and hyphens'
.\scripts\modernization\New-ModernizationPlanBundle.ps1 `
  -Track java -PlanName $planName -PlanDirectory $planDirectory `
  -Specification specs\java-asset-manager-modernization.md `
  -AllowedPaths 'legacy-src/java-asset-manager/**'
```

For BookCatalog:

```powershell
$planDirectory = Read-Host 'Actual directory containing reviewed plan.md and tasks.json'
$planName = Read-Host 'Plan name using lowercase letters, numbers, and hyphens'
.\scripts\modernization\New-ModernizationPlanBundle.ps1 `
  -Track dotnet -PlanName $planName -PlanDirectory $planDirectory `
  -Specification specs\dotnet-bookcatalog-modernization.md `
  -AllowedPaths 'legacy-src/dotnet-bookcatalog/shared-legacy-app/**'
```

Prefer narrower allowed directories or explicit files when the plan permits.
Only exact files or a directory ending in `/**` are accepted. Protected policy,
workflow, credential, binary/cache, and provenance files remain forbidden even
inside an allowed application directory.

The helper records real inputs under the track's `specs/work/.../ci-plans`
directory. It does not approve, execute, commit, or publish them.

Commit the bundle and specification through a PR. Obtain an authorized human
`APPROVED` review for its exact final head, then merge it into `main`.
An earlier-head approval, dismissed/changed review, bot review, or an
agent-written approval sentence is insufficient. The reviewer must have current
repository write authority.

Approval/configuration hashes use UTF-8 text with an optional BOM removed and
CRLF normalized to LF, so Windows/Linux checkouts do not invalidate identical
text. Other content changes invalidate approval. Reports and patches use raw
byte digests. Application freshness is bound to the Git source-tree hash, so a
docs-only commit does not unnecessarily invalidate the plan.

## 4. Dispatch the selected upgrade

On the Actions page, choose the Java or .NET approved-upgrade workflow on
`main`. Supply its bundle directory and merged approval PR number.

The workflow verifies the actor, review, exact files, target, source tree, and
allowed paths before the CLI receives its inference credential. It runs
`modernize plan execute`, not an unreviewed `modernize upgrade` request.

The candidate includes committed and uncommitted CLI edits. Job-owned technical
plan/progress state is never published. Existing test deletion, binary changes,
protected paths, excessive changes, or modified approval inputs block the run.

An isolated job then applies the exact patch and runs:

- Java: JDK 21 `clean verify`, no failing/skipped tests, and the repaired
  upstream download case still present;
- .NET: net10.0/EF Core checks, Release build, available unit tests, and
  synthetic LocalDB HTTP/CRUD/validation/antiforgery/filtering/ordering/restart
  persistence checks. Zero unit tests is never described as unit coverage.

Only afterward does a separate publisher create a clean commit and one draft
PR using the publishing PAT. It does not run candidate code. It checks that
ordinary per-track PR CI starts for the published head. Existing
[advisory PR QA](../../.github/workflows/pr-qa.md) remains disabled for drafts
until a human marks the PR ready.

The PR stays unmerged and unapproved. No changes is reported as no changes,
not as a completed upgrade. A failed run or absent required evidence does not
produce an upgrade PR. If publication creates a PR but CI is not observed, the
run reports that precise partial outcome; inspect it instead of rerunning
blindly.

## 5. Verify, disable, and recover

Run the offline fixture tests from the repository root:

```powershell
pwsh -NoProfile -File scripts\modernization\tests\Test-Modernization.ps1
actionlint -color
gh aw compile modernize-triage --strict --validate --no-check-update
gh aw validate modernize-triage --strict --no-check-update
git diff --check
```

The tests use fake model/GitHub calls and task-owned Git repositories. They do
not run a real modernization, create a GitHub PR, provision Azure, or establish
that the target applications have been upgraded.

Before enabling recurring use, set `MODERNIZE_ENABLED=pilot` and separately
authorize one real assessment/triage and approved upgrade pilot per track in
the disposable fork. Check the release
pins, actual CLI plan layout/headless behavior, model access, output contract,
Windows prerequisites, and real CI for the published SHA. Retain observed
results, not synthetic fixture output, as pilot evidence.

To stop new recurring/model work, set `MODERNIZE_ENABLED=false` or disable the
specific Actions workflow. Cancel an in-flight run separately in Actions.
Revoke the relevant credential independently.
Never force-push over an existing result branch. After a partial publication,
inspect the named branch/PR and resolve it manually before retrying.

To abandon an upgrade, close the unmerged draft PR and delete only its identified
branch with human approval. Do not reset the imported baselines or delete
unrelated resources. A successful local or fixture test does not override
failing or missing required CI.
