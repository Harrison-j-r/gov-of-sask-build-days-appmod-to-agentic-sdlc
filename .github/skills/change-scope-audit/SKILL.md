---
name: change-scope-audit
description: Reconcile one approved change specification with a Git diff, verify allowed paths and acceptance criteria, and report scope drift without changing files.
---

# Change scope audit

Use this skill after implementation and before review or merge. It is read-only
and verifies the evidence against one specification and one technology track.

## Procedure

1. Require exactly one specification under `specs/` and identify its source root.
   Stop if the specification is draft, reference-only, or lacks human approval.
2. Confirm the current diff, staged diff, and untracked files. Never edit,
   reset, stash, restore, or clean the worktree.
3. Run the structural audit:

   ```powershell
   .\.github\skills\change-scope-audit\scripts\audit-change.ps1 -Spec specs\<change>.md
   ```

   ```bash
   bash ./.github/skills/change-scope-audit/scripts/audit-change.sh specs/<change>.md
   ```

4. Compare every changed file with the specification's allowed paths and source
   root. Glob paths are allowed only when they remain inside the declared root.
5. Verify that the diff does not introduce:
   - excluded migration or cleanup;
   - cross-track changes;
   - package, dependency, schema, public API, configuration, or data changes;
   - secrets or production identifiers; and
   - generated or unrelated files.
6. Map acceptance criteria and NFR verification statements to relevant tests or
   reproducible checks. Distinguish observed evidence from missing evidence.

## Decision

Return findings ordered by severity:

- **PASS**: Changed files remain in allowed scope and evidence covers the criteria.
- **PASS WITH RISKS**: Scope is bounded, but a prerequisite or verification gap
  needs an explicit owner and follow-up.
- **BLOCKED**: Approval is absent, a changed file exceeds scope, an exclusion is
  violated, or evidence cannot prove the acceptance criteria.

Report the exact changed files, allowed-path findings, acceptance/evidence gaps,
the first blocking boundary, and the exact validation command. Do not propose or
implement a scope expansion.
