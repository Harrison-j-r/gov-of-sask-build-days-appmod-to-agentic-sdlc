# Co-located `AGENTS.md` addition worksheet

Use this worksheet before changing the nearest local guide. Do not copy the
worksheet into `AGENTS.md`.

| Question | Participant answer |
| --- | --- |
| Which file did you select? | `capstone-src/api-dotnet/tests/WorkItems.Api.Tests/InMemoryWorkItemRepositoryTests.cs` |
| Which `AGENTS.md` is nearest? | `capstone-src/api-dotnet/AGENTS.md` |
| What local map entry or invariant is missing? | Point repository behavior tests to the existing test file and the `InMemoryWorkItemRepository` production seam. |
| Why is it local rather than repository-wide? | This navigation is specific to the .NET API test project and would not be useful to Java or React work. |

Propose one bullet:

```markdown
- Repository behavior tests should follow `tests/WorkItems.Api.Tests/InMemoryWorkItemRepositoryTests.cs` and the production seam in `src/WorkItems.Api/InMemoryWorkItemRepository.cs`.
```

Keep the bullet if it helps future work in that subtree, complements the
path-specific instruction, and avoids repeating the root guide. Otherwise,
refine it before editing the local `AGENTS.md`.
