# Change specification: Invalid delete response

## Metadata

- **Owner:** Unknown; not provided.
- **Status:** Approved
- **Source root:** `legacy-src/dotnet-bookcatalog/shared-legacy-app`
- **Related issue:** Not created.

## Problem and outcomes

### Problem

BookCatalog users can submit a stale delete confirmation after the target book
has already been removed, for example by another request or a repeated
submission. In the pre-change baseline, `BooksController.DeleteConfirmed`
looked up the ID with `db.Books.Find(id)`, skipped removal when the result was
null, and still redirected to `Index`. This made a missing record look like a
successful deletion. The delete confirmation GET already returned
`HttpNotFound()` for a missing ID.

Evidence:

- The delete form posts to `Books/Delete` and includes an antiforgery token and
  hidden ID in
  [`Delete.cshtml`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Delete.cshtml),
  `Html.BeginForm`, `AntiForgeryToken`, and `HiddenFor`.
- The conventional `{controller}/{action}/{id}` route and `Books` default
  controller are configured by
  [`RouteConfig.RegisterRoutes`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/App_Start/RouteConfig.cs).
- The pre-change behavior was in
  [`BooksController.DeleteConfirmed`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs):
  a null result did not enter the removal block, but the action returned
  `RedirectToAction("Index")` unconditionally. The current working tree contains
  the behavior change; this specification records the observed pre-change
  baseline.
- `BooksController.Delete` already returned `HttpNotFound()` when its GET lookup
  returned null.
- The modernization verification checklist asks for a 404 for nonexistent IDs
  in details/edit/delete:
  [`02-execute-verify-local.md`](../labs/04-app-modernization/dotnet/02-execute-verify-local.md),
  item 8.

The affected users are people using the sample catalog who confirm deletion
from a stale page or repeat a delete request. No separate API consumer or
authentication requirement was identified. The user explicitly accepted the
302-to-404 change and excluded external callers from this scope.

### Desired outcomes

1. A missing book ID produces 404 for both the delete confirmation GET and
   delete POST, so the response does not imply that a record was deleted.
2. Deleting an existing book continues to remove it and redirect to the
   catalog.
3. Keep the change limited to the BookCatalog delete flow and preserve the
   existing antiforgery protection.

### Success measures

- Missing-ID delete GET and POST requests return 404; the POST check uses a
  valid antiforgery token.
- A successful delete of a synthetic book removes that row and redirects to
  the catalog.
- No new dependency, schema change, or automated test project is introduced.

## Functional requirements

| ID | Requirement | Evidence or rationale |
| --- | --- | --- |
| FR-1 | When a delete confirmation GET targets a nonexistent book ID, return 404. | Existing `BooksController.Delete` behavior; `02-execute-verify-local.md`, item 8. |
| FR-2 | When a delete POST with a valid antiforgery token targets a nonexistent book ID, return 404 rather than redirecting to the catalog. | Pre-change `BooksController.DeleteConfirmed` redirected on a null `Find(id)` result; aligns POST behavior with FR-1 and the lab check. |
| FR-3 | When a delete POST targets an existing book, remove and save that record, then redirect to the catalog. | Preserve existing `DeleteConfirmed` behavior and the sample's CRUD purpose. |
| FR-4 | A repeated delete after the record has been removed returns 404. | A repeated request is a missing-ID POST and follows FR-2. |
| FR-5 | Preserve antiforgery validation on the POST and the token in the delete form; do not change authentication or authorization. | `BooksController.DeleteConfirmed` has `ValidateAntiForgeryToken`; `Delete.cshtml` renders `AntiForgeryToken()`. |
| FR-6 | A database/dependency exception is not converted into a success redirect or a missing-record 404. Only an ordinary lookup result of null is the missing-record case. | Preserve explicit failure behavior; do not add a catch or success-shaped fallback. The exact framework response for database errors is unknown and is not changed by this specification. |

## Constraints and out of scope

### Constraints

- **Allowed paths:**
  - `legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs`
- **Requested specification artifact:** `specs/InvalidDeleteReponse.md`. This is the only documentation artifact requested here and is not an application implementation path.
- **Primary validation command:** `msbuild BookCatalog.sln -restore -p:Configuration=Release`, run from `legacy-src\dotnet-bookcatalog\shared-legacy-app` with Visual Studio MSBuild and web application targets available.
- **Compatibility:** Preserve successful-delete behavior. The missing-ID POST response intentionally changes from redirect to 404. External callers are out of scope by user decision; if they are later brought into scope, stop for a separate compatibility review.
- **Dependencies:** Keep the existing classic ASP.NET MVC 5, .NET Framework 4.8, and EF6 dependencies; add no packages or test project.
- **Data and security:** Use only the disposable sample LocalDB database for manual checks. Preserve the antiforgery token requirement; do not add credentials, production data, or authentication/authorization changes.

### Exclusions (out of scope)

- Modernizing or restructuring the application, migrating frameworks, or changing other controllers/actions.
- Changing successful deletion, adding soft delete, changing database schema or seed data, or altering LocalDB configuration.
- Changes to views, route configuration, model validation, authentication, authorization, or antiforgery behavior.
- Adding automated-test infrastructure, dependencies, Azure resources, or deployment behavior.
- Cleaning up unrelated files or generated project content.

## Edge cases

| Type | Condition | Expected behavior |
| --- | --- | --- |
| Normal | POST delete for an existing book with a valid antiforgery token. | Remove and save the record; redirect to the catalog. |
| Failure | POST lacks a valid antiforgery token. | Reject the request and do not delete the record. Exact HTTP status is unknown and must remain unchanged. |
| Failure | The database lookup throws rather than returning null. | Do not convert the failure to 404 or a success redirect; preserve existing framework/error handling. Exact response is unknown. |
| Boundary | GET or POST uses an ID for which no book exists. | Return 404. |
| Boundary | A delete is repeated after the first request removed the record. | The repeated request returns 404. |
| Compatibility | Existing-record POST deletion. | Continue removing the record and redirecting to the catalog. The observed smoke check followed the redirect to `/`, which maps to Books/Index. |
| Compatibility | An external caller is proposed for inclusion. | External callers are out of scope by user decision. Pause for a maintainer decision before expanding this contract to include them. |

## Acceptance criteria

### AC-1: Existing-book deletion remains successful

- **Given** a persisted synthetic book and a valid antiforgery token
- **When** the user submits the delete form for that book
- **Then** the book is removed and the response redirects to the catalog
- **Verification:** IIS Express/LocalDB smoke check; confirm the response redirects to the catalog and the synthetic row is absent afterward.

### AC-2: Missing delete-confirmation GET returns 404

- **Given** an ID with no matching book
- **When** the user requests the delete confirmation GET
- **Then** the response is 404
- **Verification:** Request `GET /Books/Delete/{missing-id}` in the local smoke check.

### AC-3: Missing delete POST returns 404

- **Given** an ID with no matching book and a valid antiforgery token
- **When** the user submits `POST /Books/Delete`
- **Then** the response is 404 and does not redirect to the catalog
- **Verification:** Obtain a token from the local delete form, submit a nonexistent ID, and record the HTTP status.

### AC-4: Repeated deletion reports the missing record

- **Given** a book was deleted successfully
- **When** the same ID is submitted again with a valid antiforgery token
- **Then** the second response is 404
- **Verification:** Repeat the POST after AC-1 and record the HTTP status.

### AC-5: Antiforgery remains enforced

- **Given** an existing book and a missing or invalid antiforgery token
- **When** a delete POST is submitted
- **Then** the request is rejected and the book is not deleted
- **Verification:** Submit without a valid token in the local smoke check. The exact rejection status is unknown; do not change it as part of this work.

## Non-functional requirements

| ID | Quality | Testable requirement | Verification |
| --- | --- | --- | --- |
| NFR-1 | Reliability | A missing record is never reported as a successful deletion. | AC-2, AC-3, and AC-4 return 404. |
| NFR-2 | Security/privacy | POST antiforgery validation remains in place; no credentials or non-sample data are added. | Review the controller/form and use only a synthetic LocalDB record for the smoke check. |
| NFR-3 | Maintainability | Keep the change within the one allowed controller path and add no dependencies or test project. | Review `git diff --name-only` and the solution/project manifests. |
| NFR-4 | Compatibility | Successful deletion continues to remove the record and redirect to the catalog. | AC-1. |

## Assumptions, dependencies, and risks

| Item | Type | Validation or mitigation |
| --- | --- | --- |
| The request is about the BookCatalog web delete flow, not a separate public API. | Assumption | The affected surface identified by the evidence is the MVC `BooksController` and its form. External consumers remain unknown; verify before approval if they are in scope. |
| The user-selected 404 behavior applies to both GET confirmation and POST submission. | Decision | Recorded from the user's clarification; enforce with AC-2 and AC-3. |
| Repeated POST after a successful delete is a missing-record case and returns 404. | Decision | Recorded from the user's request for consistent 404 behavior; verify with AC-4. |
| No automated test project exists under the selected .NET source root. | Dependency/evidence | `legacy-src/dotnet-bookcatalog/AGENTS.md` states there is no automated test project or standalone lint target; use the documented build and manual smoke check. |
| The classic project requires Visual Studio MSBuild/web targets, IIS Express, and LocalDB. | Dependency | The local guide lists these prerequisites; stop and report if any are unavailable. |
| External callers could be raised as a future compatibility requirement. | Risk | They are out of scope for this change by user decision; stop and review the contract before including them. |
| Exact HTTP status for invalid antiforgery tokens and database exceptions is not recorded. | Unknown | Preserve existing framework behavior; do not specify a new status or catch-and-map behavior without evidence and approval. |

## Plan-mode review checkpoint

### Evidence

- **Pre-change behavior:** [`BooksController.DeleteConfirmed`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs) used `db.Books.Find(id)`, removed/saved only when non-null, then unconditionally returned `RedirectToAction("Index")`. This describes the pre-change baseline captured before the current controller edit; the working tree now contains the 404 behavior.
- **Related entry point and dependency:** [`Delete.cshtml`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Views/Books/Delete.cshtml), `Html.BeginForm`, `AntiForgeryToken`, and `HiddenFor`; [`RouteConfig.RegisterRoutes`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/App_Start/RouteConfig.cs); [`ApplicationDbContext`](../legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Models/ApplicationDbContext.cs), `DbContext` and `DbSet<Book>`.
- **Expected 404 evidence:** [`02-execute-verify-local.md`](../labs/04-app-modernization/dotnet/02-execute-verify-local.md), item 8.
- **Existing tests:** None found; [`legacy-src/dotnet-bookcatalog/AGENTS.md`](../legacy-src/dotnet-bookcatalog/AGENTS.md), lines 26–28, states there is no automated test project or standalone lint target.
- **Pre-change build result:** Unknown; the build was not run before implementation.
- **Post-change validation evidence:** The initial `msbuild` invocation could not resolve the executable from PATH, and `dotnet msbuild` lacked `Microsoft.WebApplication.targets`. Using the installed Visual Studio 18 MSBuild executable directly—`& 'C:\Program Files\Microsoft Visual Studio\18\Professional\MSBuild\Current\Bin\MSBuild.exe' BookCatalog.sln -restore -p:Configuration=Release` from the source root—completed successfully (`Build succeeded`, exit code 0). The missing-ID GET and POST (with valid antiforgery token) returned HTTP 404. A synthetic create/delete smoke check confirmed successful deletion redirected with HTTP 302 to `/` and removed the row. `git diff --check` passed. The smoke-test database files were removed after confirming `App_Data` did not exist before the test.

### Unresolved questions

- None affecting the approved scope. Exact HTTP statuses for invalid
  antiforgery tokens and database exceptions remain unknown and are not changed
  by this specification.

The specification is approved for the BookCatalog MVC delete-flow scope below.
Do not expand it to external callers without a new compatibility review.

### Boundary and validation review

- [x] Evidence citations were checked against the repository and prior
      pre-change inspection.
- [x] Allowed application path is limited to the controller; no test project is
      in scope.
- [x] The primary validation command is the documented non-interactive Release
      build from the solution directory.
- [x] Acceptance criteria cover normal deletion, missing GET/POST IDs,
      repeated deletion, antiforgery, and compatibility.
- [x] Exclusions prevent unrelated modernization, data changes, and cleanup.

### Stop conditions

Stop and request human guidance if:

- repository evidence contradicts the recorded pre-change behavior or the
  selected 404 contract;
- an unresolved question could materially change behavior, compatibility,
  allowed paths, acceptance criteria, or validation;
- satisfying a criterion requires a path outside
  `legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/Controllers/BooksController.cs`;
- the baseline or primary validation fails, the command is missing or
  irreproducible, or IIS Express/LocalDB/MSBuild web targets are unavailable;
- a secret, credential, production resource, destructive action, dependency
  change, schema change, authentication/authorization change, or public API
  change is required but not explicitly approved; or
- validation cannot satisfy the acceptance criteria without expanding this
  contract.

### Human approval

- [x] I reviewed the evidence, unresolved questions, allowed paths, acceptance
      criteria, validation command, exclusions, risks, and stop conditions.
- **Reviewer:** @Harrison-j-r
- **Approval date:** 2026-11-23
- **Approved specification commit:** Pending; record the approval commit SHA in a follow-up metadata commit.

This approval authorizes issue preparation, not implementation.
