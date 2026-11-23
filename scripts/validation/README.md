# Validation scripts

Baseline wrappers resolve paths relative to their own location, so they can be
launched from any working directory.

```powershell
.\scripts\validation\validate-java.ps1
.\scripts\validation\validate-dotnet.ps1
```

```bash
./scripts/validation/validate-java.sh
./scripts/validation/validate-dotnet.sh # Git Bash on Windows
```

The Java wrapper selects JDK 8 from `JAVA8_HOME` or `JDK8_HOME` when set,
verifies the selected Java version, and runs the imported Maven reactor tests.
PowerShell also accepts `-JavaHome <path>`. The .NET wrapper restores
`packages.config` dependencies and builds the classic solution with Visual
Studio MSBuild. Use `-SkipTests` in PowerShell or `--skip-tests` in bash only
when you need a compile/package diagnostic. The .NET baseline is intentionally
Windows-only.

## Modernized targets

The legacy CI workflows select either the existing baseline profile or a
supported target profile from project metadata. Unknown/mixed profiles fail;
the target does not inherit the Java baseline's known-failure exception.

After the selected application has actually been upgraded, use:

```powershell
.\scripts\validation\validate-java-target.ps1 `
  -EvidenceDirectory (Join-Path $env:TEMP 'java-target-evidence')
.\scripts\validation\validate-dotnet-target.ps1 `
  -EvidenceDirectory (Join-Path $env:TEMP 'dotnet-target-evidence')
```

Java requires JDK 21/Spring Boot 3 and real passing reactor tests.
BookCatalog requires net10.0/EF Core on Windows and automated behavior checks
against a task-owned LocalDB instance with synthetic data. Its smoke script
checks validation, antiforgery, CRUD, filtering, ordering, and restart
persistence, then removes only its own process/instance/data.

These target validators do not change the baseline wrappers' behavior. See
the [Modernize CI/CD guide](../modernization/README.md) for approved-plan
execution and required final status checks.
