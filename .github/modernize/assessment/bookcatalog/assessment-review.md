# BookCatalog Modernize assessment review

This note supplements, and does not alter, the generated assessment. The
Modernize report is evidence for review, not an approved architecture or a
replacement for `specs/dotnet-bookcatalog-modernization.md`.

## Assessment run

- **Command:** `modernize assess --source legacy-src\dotnet-bookcatalog\shared-legacy-app --output-path .github\modernize\assessment\bookcatalog --format markdown`
- **Modernize CLI:** `1.0.95+0e5ed5bacbf0012cda3de80cea4f4b1ab9aea56b`
- **Exit code:** 0
- **Actual report:** `reports-20261124152022\index.md` and
  `reports-20261124152022\repos\shared-legacy-app\report.md`
- **Scope reported by CLI:** one app, `BookCatalog.Web`, targeting .NET
  Framework 4.8 and built with MSBuild.
- **Report limitation:** Codebase Insights were not generated; the report says
  they require Full analysis coverage. Do not treat this report as a complete
  code-level upgrade plan.

## Findings reconciled with source

| Report finding | Source evidence and review | Reconciliation |
| --- | --- | --- |
| `Identity.0002` — “Windows authentication detected” (mandatory for several cloud targets) | The reported file is `src/BookCatalog.Web/Web.config`. Its connection string at line 7 uses `(LocalDB)\MSSQLLocalDB` and `Integrated Security=True`, confirming Windows integrated authentication for the local database. No `<authentication mode="Windows">` setting was found in the app configuration. `BookCatalog.Web.csproj` line 22 has an empty `IISExpressWindowsAuthentication` element. | The finding is relevant to replacing the local database connection for cloud hosting, but it does not establish Windows authentication for application users. The approved optional Azure direction already uses managed identity and Key Vault. Do not add an application sign-in redesign. |
| `Database.0002` — SQL database connection (potential) | `src/BookCatalog.Web/Web.config` line 7 configures LocalDB and an attached sample MDF. | Confirmed baseline dependency. The approved direction replaces EF6/LocalDB with EF Core SQL Server and a new disposable lab database; this finding does not authorize business-data migration. |
| `Database.0003` — `System.Data.SqlClient` dependency (optional) | `src/BookCatalog.Web/Web.config` line 7 names `System.Data.SqlClient`; the EF6 provider is registered at line 56. | Confirmed legacy provider evidence. Replace it only as part of the approved EF Core migration. |
| `Security.0002` — connection string without configuration builders (optional) | The same connection string is local integrated-authentication configuration and contains no SQL password. | The report identifies configuration placement, not a plaintext password. Keep local credentials out of source; the approved optional Azure path uses Key Vault and managed identity. |
| `Local.0003` — local or network I/O (potential) | `src/BookCatalog.Web/Global.asax.cs` line 16 creates the application data directory for the sample's LocalDB MDF. | Confirmed local sample behavior. Do not adopt Blob Storage solely from this finding; target database and hosting design remain governed by the approved specification. |
| `Scale.0001` — static content (optional) | `src/BookCatalog.Web/BookCatalog.Web.csproj` includes the sample's static content. | Confirmed. The report's Blob Storage/CDN recommendation is not required for this local-first sample and is not authorized by the specification. |

## Missing or unsupported assessment detail

The generated report does not identify MVC 5 / `System.Web`, `Global.asax`
startup and route/filter registration, Razor compatibility, `packages.config`,
EF6 initialization and seed behavior, LocalDB's attached-MDF data boundary,
missing automated tests, the requested .NET 10 ASP.NET Core MVC / EF Core
target, or the inactive-books checkbox requirement. Validate these directly
against the source and approved specification; do not claim the CLI reported
them.

The aggregate report's approximately `$63/month` cost estimate uses
preselected Azure services and SKUs. It is directional only, not a quote,
budget, deployment approval, or requirement. Azure remains a separately gated
optional phase.

## Reconciliation decision

No evidence in this assessment requires changing the approved specification.
Keep the single-host .NET 10 ASP.NET Core MVC and EF Core direction, local-first
validation, disposable-data boundary, and optional Azure gates. Treat the
Windows-authentication finding as evidence about the local database connection,
not web-user sign-in. The other cloud-readiness items are migration
considerations, not new requirements. Review any later technical plan against
this note and the approved specification before execution.

## Technical plan creation attempt

- **Requested output:** `.github/modernize/bookcatalog-dotnet10/plan.md` and
  `tasks.json`, subordinate to the approved specification and this review.
- **Result:** `modernize plan create` exited 1 before creating the plan:
  `Failed to initialize standalone session extensions: extensionSdkPath is
  required when standalone extensions are requested`.
- **Follow-up checks:** CLI help exposes no `extensionSdkPath` option, and the
  expected plan directory does not exist. The repository's
  `.github/extensions/modernization-workbench/README.md` documents the same
  native-planning compatibility blocker and says its review-only packets are
  not executable plans. No workaround or fabricated plan was used.
- **State:** Assessment and this review note exist; no technical plan or
  application implementation was produced. Stop here until the required
  standalone extension configuration is available or the user chooses a
  documented review-only/manual planning path.
