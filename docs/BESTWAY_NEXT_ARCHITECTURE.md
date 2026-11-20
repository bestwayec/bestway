# BESTWAY NEXT architecture baseline

BESTWAY consists of this checkout and bestwayec/bw-tauri. The website proxies authenticated API calls through Next.js. Tauri calls Django directly and uses its native session bridge for token ownership. Both clients reach the same authorization and PostgreSQL data. Grandec has independent repositories and infrastructure.

## Website and API

| Surface | Existing implementation | Gap |
| --- | --- | --- |
| Dashboards | App Router dashboard and teacher workspace use existing API clients | Groups and Cohorts appear in separate workflows |
| Groups and attendance | `groups/[id]`, `attendance`, Django group and attendance services | Group workspace lacks one integrated homework workflow |
| Student detail | `students/[id]` and group/assessment views | Scope and coverage must be verified for history, homework and vocabulary |
| Exams and analytics | Mock/test runners, assessment jobs, group reports, grading queue | Shared DTOs and UI parity need contract checks |
| Vocabulary | Catalog, detail, builder, runner, SRS and battle | Assigned vocabulary, persistent flashcards and desktop parity remain gaps |

## Desktop

`App.tsx`, `Sidebar.tsx`, auth and session stores control routing and restore. The Rust session bridge owns refresh credentials. `api.ts` unwraps backend data and handles token refresh, multipart and downloads. `offline-store.ts` and `offline-exam.ts` handle exam persistence. `Settings.tsx` provides local app preferences. Native kiosk and exam behavior remain separate from staff workflows.

`GroupsResults.tsx` falls back to Cohorts on empty/error, invents a group after a failed create, substitutes display defaults for backend fields, and falls back to local export data. It dereferences the active group even when the list is empty. `GradingQueue.tsx` and `StudentResults.tsx` have separate server reads and error handling. Presence of a route does not establish successful integration. Verify real responses before reporting parity.
