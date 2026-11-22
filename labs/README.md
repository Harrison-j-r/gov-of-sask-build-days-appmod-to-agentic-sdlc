# Workshop labs

Start with [why these labs matter](../README.md#why-do-the-day-1-labs) if you
have not read it yet. In short, Day 1 gets you ready for Day 2 and shows you
how to plan, delegate, and automate work with GitHub Copilot.

Prefer a guided view? In a canvas-capable GitHub Copilot app, ask **Open the
Build Day lab guide canvas**. The optional
[lab-guide extension](../.github/extensions/lab-journey/README.md) adds
interactive steps, copy buttons, and private progress. It never executes
exercises; the documents below remain authoritative.

## Lab order

| Order | Lab | Time | You finish with |
| --- | --- | --- | --- |
| 1 | [00 Readiness](00-readiness/) | Before the event, then 15 min | Your tools checked and one track picked |
| 2 | [01 Plan mode and a spec](01-spec-driven-development/) | 20 min | One approved spec and a bounded GitHub issue |
| 3 | [02 Copilot instructions](02-copilot-instructions/) | 15 min | A trace of the guidance Copilot uses, plus one improved instruction |
| 4 | [03 Custom agents and skills](03-custom-agents-and-skills/) | 15 min | A bounded agent and a skill you have run |
| 5 | [04 App modernization](04-app-modernization/) | 20 min, then 75 min after lunch | A reviewed plan and a modernized slice that passes locally in [Java](04-app-modernization/java/) or [.NET](04-app-modernization/dotnet/) |
| 6 | [05 Agentic SDLC](05-agentic-workflows/) | 20 min | Compiled and inspected spec-to-backlog and issue-to-PR `gh-aw` workflows |
| 7 | [06 Automated QA](06-automated-qa/) | 20 min | CI still in charge, with advisory QA and bounded fixes added |
| 8 | [07 Capstone](07-capstone/) | 20 min | A small, tested demo slice |

Times come from the [event agenda](../README.md#event-agenda).

## How to work through a lab

Every lab follows the same routine:

1. Read the **Why this lab** note at the top so you know what you are building
   toward.
2. Run commands from the repository root unless the step says otherwise.
3. Do the numbered steps in order. Stop at each checkpoint and confirm you see
   the expected result before moving on.
4. Save your evidence: the command you ran and what it printed.
5. If something is blocked, write down the first failing check and use the
   documented local path. Ask a coach if you are stuck for more than a few
   minutes.

## Tips

- Pick Java or .NET once, in Lab 00, and stay on that track. You do not need
  to do both.
- Labs 01 to 03 do not change application code. They set up the spec,
  guidance, and agents that Lab 04 and later labs use.
- Labs 05 and 06 do not need live workflow runs. Compiling and inspecting the
  workflows is enough to finish.
- Copilot reads repository-wide instructions, path-specific instructions, and
  `AGENTS.md` files together. Do not assume one always wins.
  [Lab 02](02-copilot-instructions/) shows you how to trace them.

Go back to the [repository overview](../README.md) for event details,
prerequisites, source locations, Azure ownership and cleanup rules, and
facilitator and validation links.
