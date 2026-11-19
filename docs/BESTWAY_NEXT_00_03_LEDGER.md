# BESTWAY NEXT execution ledger

Branch in both repositories is `feat/bestway-next-00-03`.

| Repository | Verified remote main and remote HEAD |
| --- | --- |
| bestwayec/bestway | e38bf8a5e60198d57547dc98b42efce2eabaafef |
| bestwayec/bw-tauri | 7f97f9ed1a480f27fd2b83d32a4defeb26b936b7 |

## Stage 00 — PASS

Inspected both checkouts and documented architecture, ownership, API contracts and permissions in the four companion audit documents. Stage 00 changed documentation in Bestway only in 4b7031d1202e7fbc9680247ab4c9931104ec7632. The Tauri baseline commit above is the audited companion revision.

Fresh baseline checks on the branch bases:

- Django PostgreSQL suite via `CORS_ALLOWED_ORIGINS=http://localhost:3000 python -m pytest -q`: 1,470 passed, four legacy checks skipped, 268 subtests passed.
- Next.js `npm test`: 837 passed.
- Tauri `npm test`: 450 passed.

Environment onboarding had separately validated production builds, native WebKit launch and the existing web smoke journey on these bases. The local database was initialized from checked-in SQL because the Prisma checksum host returned HTTP 403. Standard Prisma deployment and the ledger check are separate gates.

## Stage 01 — PARTIAL

Desktop companion commit `5e99992eeed9c9c685f530b31dd899803cb80661` replaces fabricated groups and analytics with authenticated Group requests and scoped query keys. Failed writes retain the name and schedule. Exports request server reports.

Bestway changes add the shared Group OpenAPI subset and generated DTOs, deny unknown Group roles and foreign teacher mutations, scope group results to the student or linked child, and use the required PostgreSQL enum type when enrolling a student without a profile.

Fresh checks include the real PostgreSQL Group contract across both route prefixes, 49 focused Django tests and 26 subtests, TypeScript in both clients, and Chromium against the actual Django group create API. The failed-network test used an intercepted request. Canonical role normalization across all domains and fully shared API contracts remain open.

## Stage 02 — NOT STARTED

Depends on the shared authorization and Group contract.

## Stage 03 — NOT STARTED

Depends on a verified classroom-to-homework flow.
