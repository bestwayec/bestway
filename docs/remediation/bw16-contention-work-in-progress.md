# BW-16 contention mitigation — work in progress

PostgreSQL `FOR UPDATE OF r NOWAIT` detects a refresh token already locked by
another transaction, without waiting for that transaction to consume the token.
The losing request receives `REFRESH_IN_PROGRESS` (HTTP 409). The proxy passes
this condition to the client without setting or clearing session cookies. This
is shared PostgreSQL state and requires no migration, token storage, grace
period or process-local mutex. Once the lock is released, the normal rotation
and family-revoking replay checks are unchanged.

This does **not** finish BW-16. If an otherwise legitimate request arrives after
rotation committed but before its browser observed the replacement cookie, it
still presents a used token and triggers family revocation. An attacker with
only the same bearer credential is indistinguishable from that request under
the current protocol. A secure complete design must introduce independent
session binding and bounded shared coordination, consider rotation and logout
ordering, and verify the behaviour across workers and delayed responses. Do not
use this partial mitigation as evidence that concurrent refresh is fixed.

Local verification: a separate PostgreSQL connection held the refresh row;
the competing operation returned HTTP 409 without consuming the token, then
normal rotation and replay revocation passed. A frontend regression verified
that the 409 response does not overwrite or clear cookies. The existing
parallel refresh integration still fails: a request receives 409 without
automatic session recovery, and late old-token reuse can revoke the family.

A refresh network/server failure now returns 502 without clearing existing
cookies. If rotation succeeded but retrying the upstream request fails, the
502 response carries the replacement cookies so the browser can recover.
These changes do not coordinate responses across workers or prevent a late
response from overwriting a newer cookie. The parallel integration explicitly
fails if a legitimate request receives 409 rather than recovering its session.

The dashboard resume handler also returns the explicit 409 without clearing
cookies when the refresh row is locked. The contention verification now uses
an independently spawned process and tests lock release after worker termination,
followed by a successful rotation and replay rejection. This exercises shared
PostgreSQL locks and crash recovery only: it does not prove browser session
continuity, late-request coordination, or stale cookie response ordering.

The logout path now accepts proof of possession of an unexpired refresh bearer
to revoke only its token family, even if the access token has expired. Unknown
or expired bearers receive a uniform response and expired bearers cannot revoke
families. Rotation and logout serialize on the token row. If the frontend cannot
reach the backend, it clears local cookies but returns LOGOUT_UNCONFIRMED; server
revocation is not guaranteed. This does not solve the parallel refresh race.
The public refresh-bearer logout response is deliberately uniform for unknown
and expired tokens; HTTP 200 alone cannot prove that an unknown or expired
bearer revoked anything. The current UI logout caller also does not display
LOGOUT_UNCONFIRMED when the backend is unreachable, so operators must not treat
local cookie clearing as proof of server-side revocation.
