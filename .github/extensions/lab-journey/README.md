# Build Day lab guide

A repository-shared GitHub Copilot canvas for Labs 00-07. Choose Java or .NET,
follow source-backed steps, copy exercise blocks, and save private,
self-reported progress. The [Markdown lab index](../../../labs/README.md)
remains the fallback and the lab documents remain authoritative.

## Open the guide

1. Open your workshop checkout in a canvas-capable GitHub Copilot app.
2. Start a new session, or ask Copilot to reload extensions.
3. Ask: **Open the Build Day lab guide canvas.**
4. Choose your application track and command shell. Use only the chosen
   modernization track; the classic .NET baseline requires Windows.

The canvas type is `lab-journey`. It exposes `get_guide`, `get_progress`, and
`update_progress` actions. Updates require the current revision and never
execute or validate participant exercises.

## Use the guide

Click a lab or step, expand its instructions, and use Copy for an exact source
block. Commands display their source working-directory context; review it and
any directory-changing commands before running a copied block yourself.
PowerShell/Bash alternatives follow the shell selection. Source views preserve
the canonical alternatives and explicitly marked placeholders.

Mark checkpoints Done or Blocked only after doing the exercise yourself.
These are navigation reminders, not test results, approval records, or CI.
No prompts are sent and no commands, deployments, or GitHub writes run here.

Animations follow the app's reduced-motion setting and the Animations switch.
The guide supports app light/dark themes, keyboard navigation, a narrow panel,
and a source-document dialog. Reset asks for confirmation and affects only
the selected repository/track.

## Private progress

Progress is stored in:

```text
$COPILOT_HOME/extensions/lab-journey/artifacts/<repository-hash>.json
```

Without `COPILOT_HOME`, the base is `~/.copilot`. The file contains only track,
shell, motion, current steps, checklist statuses, and predefined blocker
categories. It is not committed, synchronized, or sent to an external service.

Checkouts are isolated; worktrees of the same local checkout share progress.
Another clone or fork starts fresh. Two panels refresh saved progress on focus
and periodically while visible. A stale update fails visibly: refresh and
repeat your intended change.

Corrupt files and denied writes are errors, not automatic resets. Back up the
exact affected file before resolving a storage problem. If a provider crashes
while writing, an adjacent `<repository-hash>.json.lock` directory may remain.
After stopping all lab-guide providers, remove only that exact empty lock
directory and reopen the guide. Never delete the artifact folder or other
participants' files.

Lab content is loaded when the extension starts. After editing lab documents,
reload the extension to refresh the catalog. Missing sections, disallowed
paths, and invalid saved navigation are reported rather than silently hidden.
Only explicitly allowlisted participant documents are viewable; facilitator
solutions and arbitrary files are not exposed.

## Validation

Run from repository root:

```powershell
node --test .github\extensions\lab-journey\tests\lab-journey.test.mjs
git diff --check
```

The tests use synthetic state in temporary directories, not your progress.
Check modified modules with `node --check`, reload and inspect the extension,
and verify capability discovery, open, actions, rejected inputs, rehydration,
and a second panel. Exercise copy success/denial, keyboard use, source links,
reset confirmation, themes, narrow layout, and reduced motion in the browser.
Existing repository CI remains merge authority; no workflow locks are changed.

Optional real-browser gate (Node, npm, and an installed Microsoft Edge):

```powershell
npm exec --yes --package playwright --call "node --test .github\extensions\lab-journey\tests\browser.test.mjs"
```

This command downloads test tooling into npm's cache if needed, not the
repository or production extension. It starts and closes a temporary local
server with synthetic progress, and verifies clipboard success/denial, source
safety, navigation, reset/resume, narrow layout, themes, and reduced motion.
Use `LAB_GUIDE_BROWSER` for another installed Playwright browser channel or
`LAB_GUIDE_BROWSER_PATH` for an explicit browser executable path.

Authoring checks observed on Windows: all 11 core tests and the real Edge
browser gate passed. Module syntax, whitespace, and changed Markdown local
targets passed. Runtime discovery/open/actions, invalid-input and reserved
action rejection, and saved motion preference across provider reload and a
second panel were verified. Lychee was unavailable; its full offline fragment
gate was not run. No application builds, Azure deployment, or live workflows
were performed for this navigation-only change.

## Branding and limitations

The layout uses GitHub Green with neutral surfaces and documented app theme
tokens, following the [Brand Toolkit](https://brand.github.com/). It uses a
text GitHub integration link rather than reproducing restricted logo artwork.
The guide is workshop material, not an official GitHub product or endorsement.
No runtime fonts, images, libraries, or analytics are downloaded.

The renderer supports headings, lists, inline code/emphasis, links, and fenced
blocks. Other Markdown is displayed as escaped text; raw HTML cannot execute.
Some local links are intentionally not interactive: open those targets in
your checkout. For complete formatting or facilitator-led recovery, consult
the original source. Never substitute a checklist tick for observed evidence.
