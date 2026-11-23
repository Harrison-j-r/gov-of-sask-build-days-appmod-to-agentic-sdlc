---
applyTo: "capstone-src/api-dotnet/tests/**/*.cs"
---

# .NET API test guidance

- Write repository and contract tests with xUnit, keeping assertions in the owning `WorkItems.Api.Tests` project and using the existing `Fact` and `Assert` conventions.
- Exercise `IWorkItemRepository` or `InMemoryWorkItemRepository` behavior directly against `capstone-src/api-dotnet/src/WorkItems.Api/WorkItem.cs` and `InMemoryWorkItemRepository.cs`; verify shared API semantics against `capstone-src/contracts/openapi.yml`.
- Test deterministic state transitions with `StubTimeProvider` or another `TimeProvider` substitute rather than wall-clock timing.
- Keep tests isolated and local: do not require IIS, LocalDB, Azure, HTTP servers, network access, production data, or timing-based waits.
- From the repository root, run `dotnet test capstone-src/api-dotnet/tests/WorkItems.Api.Tests/WorkItems.Api.Tests.csproj` as the smallest deterministic validation command.
