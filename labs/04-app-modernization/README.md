# Lab 04: Application modernization

> **Why this lab:** Learn application modernization (AppMod) by moving a legacy
> Java or .NET app to modern frameworks and runtimes. Use Modernize CLI and the
> Upgrade agent, review each change, and test that the app's behavior still works.
>
> **Time:** 20 minutes for assessment and planning, then 75 minutes after
> lunch for the upgrade.

Choose one first-class track:

- [Java Asset Manager](java/) — supported on Windows, macOS, or Linux.
- [.NET BookCatalog](dotnet/) — the classic baseline requires Windows,
  Visual Studio/MSBuild, .NET Framework 4.8, and LocalDB.

Both tracks extend the contract-first workflow from
[Lab 01](../01-spec-driven-development/README.md). GitHub Copilot Plan mode and
a human-approved, durable repository specification define intent, constraints,
acceptance criteria, allowed paths, validation, and stop conditions before
modernization tooling runs. `modernize assess` then contributes repository
evidence, and `modernize plan create` turns the approved contract plus that
evidence into a specialized technical modernization plan.

The required sequence is: approved specification -> `modernize assess` ->
human-reviewed Modernize plan -> `upgrade-agent` execution.

A generated modernization plan is a proposal, not approval and not a second
specification framework. Reconcile it against the durable specification before
execution. Review its scope, allowed paths, security and data handling, cost,
validation, stop conditions, deployment boundaries, and cleanup. Resolve every
conflict in favor of the approved specification or revise and reapprove that
specification.

Modernize may generate a plan task file as tool output. That file is part of
the reviewed technical proposal; it does not make the optional repository ADR,
test-strategy, or implementation-task-breakdown templates required.

The `upgrade-agent` plugin in the GitHub Copilot app performs the reviewed
runtime/framework execution. Participants approve bounded increments and
inspect commands and diffs; the plugin does not redefine requirements. Both
tracks preserve language-specific tooling and provide a local/no-deployment
completion path. Complete only the selected track and do not edit the other
imported application.

Azure deployment is optional. Each track documents a local/no-deployment
completion path and requires exact cleanup evidence when Azure resources were
created.

## The three-step framework in this workshop

Read
[How GitHub Copilot and AI agents are saving legacy systems](https://github.blog/ai-and-ml/github-copilot/how-github-copilot-and-ai-agents-are-saving-legacy-systems/)
for the three-step framework for AI-powered legacy modernization. The article
uses COBOL and Semantic Kernel; this workshop applies the ideas to Java or .NET
with the GitHub Copilot app and GitHub Agentic Workflows.

| Step from the article | How you apply it here |
| --- | --- |
| 1. Code preparation (reverse engineering) | Inspect the selected app in Lab 01. In Lab 04, use `modernize assess` to understand its business logic, dependencies, and upgrade risks. Check the findings against the code and review them before planning changes. |
| 2. Enrichment | Keep the approved spec from Lab 01 and the repository guidance from Lab 02 available to Copilot. Record reviewed findings so agents can use the same context. Reconcile the Modernize plan with that spec before execution. |
| 3. Automation aids | Use the agents and skills from Lab 03 and the Upgrade agent for bounded work. Run the selected track's validation after each increment. Labs 05 and 06 add repeatable SDLC and QA workflows while deterministic CI remains the merge authority. |

Keep human review at each step. Tests should check the business behavior you
need to preserve, as well as whether the upgraded app builds.
