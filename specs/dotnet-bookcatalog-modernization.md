# .NET BookCatalog modernization

## Metadata

- **Owner:** BookCatalog modernization participant
- **Status:** Approved
- **Source root:** `legacy-src/dotnet-bookcatalog/shared-legacy-app`
- **Related issue:** Not created

## Problem and outcomes

### Problem

BookCatalog is a classic ASP.NET MVC 5 application targeting .NET Framework
4.8, using EF6 and LocalDB. Its controller serves an active-only, title-sorted
catalog and the create, details, edit, and delete workflows. The list also
renders the request User-Agent, which is not catalog behavior and exposes
request metadata in the UI.

Evidence: [source README](../legacy-src/dotnet-bookcatalog/shared-legacy-app/README.md),
[`BookCatalog.Web.csproj`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/BookCatalog.Web.csproj),
[`BooksController`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs),
[`Book`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/Book.cs),
[`ApplicationDbContext`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/ApplicationDbContext.cs),
[`RouteConfig`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/App_Start/RouteConfig.cs),
[`Web.config`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Web.config),
and [Index.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Index.cshtml).

### Desired outcomes

1. Move the sample to one .NET 10 ASP.NET Core MVC host using EF Core, without
   carrying forward the legacy System.Web host.
2. Preserve the catalog workflows and validation while removing the
   User-Agent diagnostic, and let users opt into showing inactive books with
   an unchecked-by-default checkbox.
3. Use a new, disposable workshop database and verify the upgraded app locally
   before considering any optional deployment.

### Success measures

- The target Release build and the repository's .NET target validator pass.
- The validator's synthetic-data checks pass for catalog filtering, ordering,
  CRUD, input validation, antiforgery, and restart persistence.
- A browser check confirms the `Include inactive books` checkbox is unchecked
  by default and, when selected, makes inactive books available to view and
  edit.
- After implementation, the `change-scope-audit` skill reports **PASS** against
  this approved specification before review or merge. **PASS WITH RISKS** or
  **BLOCKED** requires the identified gaps to be resolved before this measure
  is met.
- Any Azure deployment is a later, separately approved activity with exact
  cleanup evidence; no deployment is required to complete the local upgrade.

## Functional requirements

| ID | Requirement | Evidence or rationale |
| --- | --- | --- |
| FR-1 | The root route and `/Books` shall display active books in ascending title order by default. An `Include inactive books` checkbox shall be unchecked by default; when selected, the list shall include active and inactive books in ascending title order. A fresh workshop database shall show six active seed books by default and hide the inactive Matrix record until the checkbox is selected. | [`RouteConfig`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/App_Start/RouteConfig.cs), [`BooksController.Index`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs), [`BookCatalogInitializer.SeedBooks`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/ApplicationDbContext.cs); user-requested checkbox behavior |
| FR-2 | Users shall be able to view details, create, edit, and delete books. Inactive books shall be available for these actions when included in the catalog using the checkbox. Missing book IDs for details and edit shall return 404; deleting a missing ID shall not cause an unhandled error. | [`BooksController`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs); participant-reported inability to find an inactive book through the current catalog |
| FR-3 | Book validation shall preserve required Title and Author, their 200- and 100-character limits, the 13-character ISBN limit, and the optional Published Year range 1800 through 2100. Invalid submissions shall not change the catalog and shall show validation feedback. | [`Book`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/Book.cs), [Create.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Create.cshtml), [Edit.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Edit.cshtml) |
| FR-4 | State-changing create, edit, and delete requests shall retain antiforgery protection. | [`BooksController`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs), [Create.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Create.cshtml), [Edit.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Edit.cshtml) |
| FR-5 | The catalog page shall not read or render the request User-Agent or a browser diagnostic label. | User decision; current reads are in [`BooksController.Index`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs) and rendering is in [Index.cshtml](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Index.cshtml). |
| FR-6 | New and edited records shall persist across application restarts. The upgraded app shall use the new `BookCatalogModernizedLab` database with deterministic seed data and migrations; it shall not import records from the old MDF or delete/recreate the database on every startup. | [Source README](../legacy-src/dotnet-bookcatalog/shared-legacy-app/README.md), [`ApplicationDbContext`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/ApplicationDbContext.cs), and the Lab 04 .NET [execution guide](../labs/04-app-modernization/dotnet/02-execute-verify-local.md) |

## Constraints and out of scope

### Constraints

- **Allowed paths:**
  - `legacy-src/dotnet-bookcatalog/shared-legacy-app/BookCatalog.sln`
  - `legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/**`
- **Primary validation command:** From
  `legacy-src/dotnet-bookcatalog/shared-legacy-app` in PowerShell 7.4 or later
  on Windows:

  ```powershell
  & ..\..\..\scripts\validation\validate-dotnet-target.ps1 `
    -Root (Resolve-Path ..\..\..).Path `
    -EvidenceDirectory (Join-Path $env:TEMP 'dotnet-target-evidence')
  ```

  This target gate requires .NET 10 and Windows LocalDB. It restores and builds
  the target solution, runs any discovered test projects, and runs the
  repository's synthetic-data HTTP/CRUD/validation/antiforgery/filtering/
  ordering/restart-persistence smoke check. It uses and cleans its task-owned
  LocalDB instance and temporary data. Zero discovered unit tests must not be
  described as unit-test coverage.
- **Baseline command and result:** From the source root,
  `msbuild BookCatalog.sln -restore -p:Configuration=Release` was attempted
  but `msbuild` was not on `PATH`. Visual Studio Build Tools MSBuild was found
  with `vswhere`; invoking its installed executable with
  `BookCatalog.sln -restore -p:Configuration=Release` from the source root
  completed with `Build succeeded` and exit code 0.
- **Compatibility:** Preserve the default Books/Index route, active-only
  title ordering, details and CRUD behavior, model validation, antiforgery, and
  persistence across restart. Keep the existing sample styling where
  practical.
- **Architecture:** Use a single ASP.NET Core host as an in-place cutover.
  Do not add a side-by-side System.Web host, YARP proxy, System.Web adapters,
  or a shared legacy schema. If assessment evidence contradicts this direction,
  stop and obtain specification review before changing the architecture.
- **Dependencies:** Replace legacy MVC 5 / EF6 dependencies with compatible
  ASP.NET Core MVC and EF Core SQL Server dependencies on the .NET 10 target.
  Do not add unrelated packages or projects without revising this contract.
- **Data and security:** Use only disposable workshop data. Do not migrate old
  MDF records or point to a business database. Use local integrated
  authentication and no SQL password in source or configuration. Keep
  antiforgery checks on mutations. The optional Azure configuration must use
  Key Vault and the user-assigned managed identity described by the imported
  Azure assets, not a committed secret or SQL password.
- **Deployment:** Local verification is mandatory. Azure is optional and is
  not authorized by this specification. Before any Azure resource creation,
  obtain separate approval for an owned non-production subscription, exact
  resource group, region, budget/cost, role assignments, and public
  unauthenticated exposure. Do not claim production hardening.
- **Cleanup:** If separately approved Azure resources are created, use the
  imported safety-checked cleanup flow for the exact dedicated resource group
  and independently verify `az group exists` returns `false`. Preserve the
  real cleanup result. Do not purge recoverable Key Vault metadata without
  separate authorization.

### Exclusions (out of scope)

- Java track changes, capstone applications, workflows, and repository-wide
  cleanup.
- Importing legacy MDF data, changing to a shared/business database, or
  resetting the database on every startup.
- Side-by-side hosting, YARP, System.Web adapters, authentication redesign,
  SQL passwords, or production-hardening claims.
- Azure provisioning or deployment as part of this specification task.
- Editing imported Azure assets, validation scripts, or files outside the
  allowed paths. Tool-generated assessment and technical-plan artifacts are
  separate evidence, not an expansion of the application edit allowlist.

## Edge cases

| Type | Condition | Expected behavior |
| --- | --- | --- |
| Normal | Fresh synthetic database with six active seeds and one inactive Matrix seed; checkbox is unchecked | Only the six active books appear, in ascending title order. |
| Boundary | User selects `Include inactive books` | Active and inactive books appear in ascending title order with their existing view/edit/delete actions; changing the filter alone does not change book data. |
| Failure | Invalid required text, length, or year values are submitted | Validation feedback appears and the catalog remains unchanged. |
| Boundary | A request has an absent or distinctive User-Agent value | No User-Agent value or browser diagnostic label is read or rendered. |
| Compatibility | A requested book ID does not exist | Details and edit return 404; delete does not produce an unhandled error. |
| Persistence | A book is created or edited, then the app stops and restarts | The saved record and edited value remain in the new lab database. |
| Data boundary | The legacy MDF contains records or a business database is configured | Do not transfer or access those records; use only the named disposable workshop database. |
| Deployment boundary | Cost, policy, quota, ownership, or role approval is missing | Do not provision or weaken controls; complete the documented local/no-deployment path. |

## Acceptance criteria

### AC-1: Active catalog remains the default

- **Given** a fresh, synthetic `BookCatalogModernizedLab` database with the
  deterministic seed set
- **When** a user opens `/` or `/Books` without selecting `Include inactive
  books`
- **Then** six active books appear in ascending title order and the inactive
  Matrix record does not appear, and the checkbox is unchecked
- **Verification:** Run the primary validation command and record its actual
  smoke-check result.

### AC-2: Users can include and manage inactive books

- **Given** an inactive book exists and `Include inactive books` is unchecked
- **When** a user selects the checkbox and submits the catalog filter
- **Then** inactive and active books appear in ascending title order, and the
  inactive book has working view/edit/delete actions; editing its Active value
  can return it to the default active catalog
- **Verification:** In a browser, confirm the checkbox starts unchecked, the
  inactive seed or a synthetic inactive book is hidden by default and appears
  when selected, its view/edit actions work, and changing its Active value
  changes whether it appears when the filter is unchecked

### AC-3: CRUD and missing-record behavior are preserved

- **Given** the local application is running against the new lab database
- **When** a user views, creates, edits, and deletes a synthetic book
- **Then** each action completes with the existing catalog behavior, and
  missing details/edit IDs return 404 without an unhandled error
- **Verification:** The target smoke script exercises create, details, edit,
  delete, and missing IDs; record its actual result.

### AC-4: Validation and antiforgery remain effective

- **Given** a create or edit request has missing or over-limit title/author,
  an over-limit ISBN, an out-of-range year, or no valid antiforgery token
- **When** the request is submitted
- **Then** invalid input is rejected with visible validation feedback, a
  tokenless mutation is rejected, and invalid input does not change the
  catalog
- **Verification:** Run the target validation command and record the actual
  synthetic HTTP check result.

### AC-5: User-Agent diagnostic is removed

- **Given** a request to the catalog includes any User-Agent header
- **When** the catalog page is rendered
- **Then** neither the value nor a browser-diagnostic label is displayed, and
  the request value is not read for this page
- **Verification:** The source diff shows the diagnostic read/render removed;
  inspect a response containing a distinctive synthetic User-Agent.

### AC-6: Workshop data persists without legacy transfer

- **Given** a new `BookCatalogModernizedLab` database initialized by
  migrations with deterministic synthetic seed data
- **When** a synthetic book is edited and the app is restarted
- **Then** the edit persists, the database is not recreated on every startup,
  and no old MDF records were transferred
- **Verification:** The target smoke check verifies restart persistence;
  review migrations/configuration for the new database name, non-destructive
  startup, and absence of legacy-data transfer.

### AC-7: Local target gate passes

- **Given** the .NET 10 SDK, PowerShell 7.4 or later, and Windows LocalDB are
  available
- **When** the primary validation command runs from the source root
- **Then** target restore/build and the synthetic behavior smoke checks pass;
  any unit-test count is reported accurately
- **Verification:** Preserve the command, exit status, and concise actual
  output. Do not claim tests passed if the command was not run.

## Non-functional requirements

| ID | Quality | Testable requirement | Verification |
| --- | --- | --- | --- |
| NFR-1 | Data safety | Only the new disposable lab database is created or modified by local validation; legacy MDF and business databases are never used as target data. | Review connection configuration and migrations; verify the validation script uses and cleans its task-owned LocalDB instance. |
| NFR-2 | Security/privacy | No SQL password, credential, or secret is committed; mutations retain antiforgery; the User-Agent diagnostic is removed. | Diff/config review and AC-4/AC-5 checks. |
| NFR-3 | Reliability | Migrations initialize the lab database without deleting/recreating it on every startup; changes persist through restart. | Review startup/migration logic and verify AC-6. |
| NFR-4 | Cost and operations | Azure is optional and gated by explicit ownership, budget, region, role, and exposure approval; created resources have exact cleanup evidence. | Review approval before deployment and independently verify the exact group no longer exists after cleanup. |

## Assumptions, dependencies, and risks

| Item | Type | Validation or mitigation |
| --- | --- | --- |
| The .NET 10 ASP.NET Core MVC and EF Core direction matches the Lab 04 target. | Confirmed workshop constraint | Reconcile Modernize assessment evidence against this specification before technical planning. |
| Existing database contents are disposable and need not be migrated. | Confirmed workshop constraint | Use `BookCatalogModernizedLab` and never configure the old MDF or a business database as target data. |
| This small sample should use a single-host cutover rather than a side-by-side migration. | Architecture decision per Lab 04 | Revisit only if assessment evidence contradicts the choice; stop and reapprove any scope change. |
| Azure deployment may be unavailable because of cost, policy, quota, ownership, public exposure, or role restrictions. | Risk | Local verification is sufficient for the no-deployment path; do not weaken controls to force deployment. |
| The current source-root inventory contains no test project. | Repository observation | The target validator runs available test projects and separately runs synthetic HTTP/LocalDB behavior checks; report zero tests as zero coverage. |

## Plan-mode review checkpoint

### Evidence

- **Current behavior:** `BooksController.Index` filters active books, orders
  by title, and reads the request User-Agent; `Index.cshtml` renders the
  diagnostic. `Book` declares validation limits and `ApplicationDbContext`
  seeds six active books plus one inactive Matrix record.
- **Existing tests:** No test project was observed in the selected source-root
  inventory. The target validation script provides a synthetic LocalDB
  behavior smoke check.
- **Baseline validation evidence:** From
  `legacy-src/dotnet-bookcatalog/shared-legacy-app`,
  `msbuild BookCatalog.sln -restore -p:Configuration=Release` initially could
  not run because `msbuild` was not on `PATH`. `vswhere` found Visual Studio
  Build Tools MSBuild. Running the equivalent Release restore/build with that
  installed executable from the source root completed successfully:
  `Build succeeded`, exit code 0.
- **Observed legacy page:** IIS Express served `/Books` successfully with
  HTTP 200. The browser displayed six active books in ascending title order,
  omitted the inactive Matrix record, and rendered the `YOUR BROWSER` line
  with the current browser's User-Agent. This was a page-load observation, not
  a check of CRUD or validation.
- **Participant-reported manual checks:** The participant reports six books
  displayed with row numbers 1-6, viewing several books, editing the first
  book's year to 2009, successful book creation and deletion, and an inactive
  book disappearing from the list with no visible catalog control to find it
  again. The participant also reports that another created book displayed row
  number 7. The source view uses an incrementing row counter, so this is a
  display position rather than the database ID. A screenshot is available to
  the participant but was not added to the repository.
- **Restart persistence:** The first displayed book is database ID 4. Before
  restart, its edit page returned HTTP 200 and showed Published Year 2009.
  After stopping and relaunching IIS Express against the same source, `/Books`
  and `/Books/Edit/4` returned HTTP 200 and the edit page still showed 2009.
  The edited year therefore persisted through an IIS Express restart.
- **Routes:** After restart, both `/` and `/Books` returned HTTP 200 and
  displayed the catalog.
- **Validation:** Synthetic HTTP POSTs to `Books/Create`, using the rendered
  antiforgery token, omitted Title, omitted Author, and submitted years 1799
  and 2101. Each returned HTTP 200 with field-validation feedback, and none of
  the unique synthetic markers appeared in the catalog afterward. These
  checks did not cover overlength values or tokenless requests.
- **Modernize assessment:** Not run. No CLI assessment findings are claimed.
- **User decisions:** Remove the User-Agent diagnostic; add an unchecked-by-
  default `Include inactive books` checkbox so users can reveal and manage
  inactive books; document Azure as an optional later phase with explicit
  cost, permission, and cleanup gates; do not deploy under this specification
  work.

### Unresolved questions

- Azure subscription, region, budget, and role details are intentionally
  undecided. They are required only before a separately approved deployment.
- The Modernize assessment has not been run. If it later provides evidence
  that changes requirements, architecture, allowed paths, validation, or
  boundaries, revise and reapprove this specification before technical
  planning or implementation.

If later assessment evidence would change this contract, revise and reapprove
the specification before technical planning or implementation.

### Boundary and validation review

- [x] Repository evidence citations were checked against the selected .NET
      source and applicable Lab 04 guidance.
- [x] Allowed application paths are limited to the BookCatalog solution and
      web project; generated build output, package content, and imported Azure
      assets are excluded.
- [x] The primary target validation command is non-interactive and runs from
      the stated source root with an explicit repository root.
- [x] Acceptance criteria cover normal, failure, boundary, and compatibility
      behavior, including the user-approved diagnostic removal.
- [x] Exclusions prevent Java changes, legacy-data transfer, side-by-side
      hosting, secrets, and unapproved deployment.
- [x] Participant-reported list and CRUD observations are recorded; the
      available screenshot was not added to the repository.
- [x] Restart persistence was verified for the edit to book ID 4.
- [x] Legacy missing-field and out-of-range-year validation checks are
      recorded; overlength and tokenless cases were not part of this baseline
      probe.
- [x] Human review and approval are recorded below.

### Stop conditions

Stop and request human guidance if:

- legacy runtime observations or Modernize assessment evidence contradict this
  specification;
- a decision would change catalog behavior, data handling, security, cost,
  deployment, validation, or architecture;
- satisfying a requirement needs a path outside the allowlist or a new project
  or dependency not approved here;
- the baseline or target validation fails and the first actionable error is
  not understood;
- a secret, business database, destructive data operation, or Azure resource
  is required without the separate approval described above; or
- scope expansion, failed validation, or missing prerequisites prevent a
  criterion from being verified.

### Human approval

- [x] I reviewed the evidence, unresolved questions, allowed paths, acceptance
      criteria, validation command, exclusions, risks, and stop conditions.
- **Reviewer:** @Harrison-j-r
- **Approval date:** 2026-11-23
- **Approved specification commit:** `9dfc4f4`

This approval does not authorize implementation or Azure deployment.
