# API contract audit

Django mounts core routes at `/v1/` and `/api/v1/`. Next.js uses its own authenticated proxy. Desktop calls the API directly. Maintain those entry points and existing aliases.

| Domain | Routes | Contract observations |
| --- | --- | --- |
| Auth | `/auth/login`, `/auth/me`, desktop exchange/refresh | Bearer identity resolves the active stored role. Keep native refresh and web cookie paths intact. |
| Groups | `/groups`, `/groups/{id}`, `/groups/{id}/students` | Lists use an array in the success envelope. Creation returns 201 with the server ID. Schedule is an array of day, startTime and endTime. |
| Group reports | `/groups/{id}/analytics`, `/groups/{id}/export/excel` | Analytics is JSON. File routes send attachment responses outside the JSON envelope. |
| Cohorts | `/teacher/cohorts/` | Django-owned IDs and membership semantics differ from Group. A response from this endpoint cannot replace a Group response. |
| Attendance | `/attendance`, `/attendance/bulk`, `/attendance/group-summary/` | Use existing scope checks and day parsing. Preserve current support for legacy payload aliases. |
| Vocabulary | `/vocabulary/sets`, set quiz/submit/report, SRS quiz/submit/stats | Existing access and scoring code in `vocabulary_views.py` and `vocabulary_service.py`. Verify practice-session binding, duplicate submissions and private visibility before awarding assignment credit. |

Most JSON routes return success/data or success/error. Some list endpoints paginate in a nested results object. Capture response shape per operation and test both mounted prefixes. Prefer one checked-in schema and generated types over hand-maintained parallel DTOs. Keep offline, malformed responses, HTTP failures and server-confirmed writes distinct.
