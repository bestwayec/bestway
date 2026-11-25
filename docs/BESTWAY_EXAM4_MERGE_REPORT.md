# BESTWAY Exam System 4.0 · Integration report

| Ref | Verified starting commit |
| --- | --- |
| main | `9c37f60c0b23c7e6e0cde254632da7cdd9c281c1` |
| Phase 1 | `b0849f552d146991dfd8ae0b09cc56573ca799b0` |
| Phase 2 | `16d0ea90a99b81682eed8bb5a19a12f756119e3e` |
| Phase 3 | `e43f15389a6b0d824bf6e2b28d362014369b8537` |

Git ancestry checks confirmed that each row is an ancestor of the row below it. The integration branch `fix/bestway-exam4-final-integration` was created from the exact Phase 3 commit and pushed without force. The public PR list had no Phase 1–3 entries at inspection. GitHub REST denied PR and Actions requests with HTTP 403. The public comparison is available for opening a cumulative integration candidate against main. [View the comparison](https://github.com/bestwayec/bestway/compare/main...fix/bestway-exam4-final-integration?expand=1)

| Gate | Status |
| --- | --- |
| Cumulative hosted CI and real Prisma migration | Awaiting an authenticated integration PR and successful checks on its exact head |
| Phase 1, Phase 2, Phase 3, Phase 4 merges | Pending all release gates and safe intermediate states |
| Final main CI | Pending merges |
| Production workflow | Both deployment workflows use manual dispatch and a production environment. This task initiated no deployment. |

Run the cumulative integration PR into main first. A stacked PR into a feature branch does not trigger the existing branch-filtered CI. Once the candidate and required checks pass, verify each exact head and safe intermediate state, then review and merge in dependency order using ancestry-preserving merges when supported. After each merge, confirm main CI and revalidate the next comparison. The Mock 27 publication fix is important when evaluating whether the Phase 2 and Phase 3 intermediate states can be merged safely.

For the Mock 27 regression, move the numbered Reading boundary fix into the Phase 2 dependency before considering the Phase 2 merge. Forward-merge the verified repair into later stacked branches and rerun the affected candidate checks. Preserve the integration branch while the cumulative gate is pending.
