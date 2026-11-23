---
name: test-evidence-inventory
description: Inventory test projects, frameworks, test classes, coverage signals, and the smallest validation commands for one Java or .NET source root without running tests or editing files.
---

# Test evidence inventory

Use this skill to determine what can prove behavior in exactly one Java or
.NET source root. It starts read-only and does not run Maven, MSBuild, or dotnet
test.

## Procedure

1. Require exactly one root:
   - Java: `legacy-src/java-asset-manager`
   - .NET: `legacy-src/dotnet-bookcatalog/shared-legacy-app`
   - Add a capstone root only when explicitly requested.
2. Run the inventory:

   ```powershell
   .\.github\skills\test-evidence-inventory\scripts\inventory-tests.ps1 -ProjectRoot legacy-src\dotnet-bookcatalog\shared-legacy-app
   ```

   ```bash
   bash ./.github/skills/test-evidence-inventory/scripts/inventory-tests.sh legacy-src/java-asset-manager
   ```

3. Classify test evidence as unit, integration, browser, database, or
   environment-dependent. Inspect only the selected root.
4. Distinguish frameworks and fixtures from claims of coverage. A test file near
   the code is not proof of a specific acceptance criterion.
5. Map each acceptance criterion to the smallest reproducible check. Note missing
   normal, failure, boundary, or compatibility cases.
6. Report prerequisites, exact proposed commands, and stop conditions.

## Guardrails

- Do not restore, clear caches, start databases or services, publish, deploy,
  edit files, or run test commands unless explicitly approved for a separate
  validation step.
- Never inspect both technology tracks in one diagnosis.
- Do not read credentials or user-level settings.
- For missing .NET test infrastructure, state the gap rather than inventing a
  passing test project.

Return evidence-backed findings, coverage gaps, exact validation commands, and
the strongest conclusion supported by repository files.
