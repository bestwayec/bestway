# BESTWAY Exam System 4.0 · Release checklist

## Required before approval

- [ ] Confirm cumulative hosted CI on the exact integration HEAD, including normal Prisma 5.22.0 validation, migration deployment and checksum ledger.
- [ ] Confirm additive upgrade and repeat deployment on clean and existing databases with synthetic historical attempts.
- [x] Complete eight uninterrupted native Multilevel recordings and review their server-reported duration and playback in Chromium.
- [ ] Verify Android physical microphone, iOS Safari and a released desktop client.
- [ ] Resolve release-blocking findings and verify the final merged main SHA with its own hosted CI.
- [ ] Review dependency advisories that remain and use the coordinated Django and Next.js cutover.

## Backup and application rollback

- Capture a PostgreSQL backup and media inventory. Confirm the backup is readable and rehearse restoration in an isolated environment before any production change.
- Apply canonical Prisma migrations first, then Django migrations. Verify the migration ledger and the legacy-schema contract before replacing the Django or Next.js containers.
- Keep the previous frontend and backend images together for application rollback. The prior application images can continue using the expanded schema with the nullable question explanation. Preserve that schema during application rollback.
- Database restoration is a separate operational decision. Preserve current evidence, identify the recovery point and reconcile writes since the backup before an authorized restore.
- Follow the existing manual production workflow and its approval requirements. The Phase 4 task did not operate production.

## Authorized post-release smoke

- Check both health endpoints and the deployed build ID against the approved main SHA.
- Use synthetic administrative, teacher and learner accounts to verify the language routes, exam launch and review.
- Confirm one saved edit, reconnect and resume, one submission and one authorized playback range.
- Check teacher scoring, classroom reports, protected exports, pending and zero values, and worker health.
- Verify the official desktop landing page and one published installer link, then exercise the prior supported client contract from a real installed client.

## Physical device checklist

Repeat on Android Chrome or the supported Android client, iPhone Safari, and the supported installed desktop release. Record OS, app/browser version, microphone format and server duration.

1. Grant, deny and regrant permission, then verify the startup prompt and response timer.
2. Record each skill-bounded Speaking take at normal speed and verify the decoder receipt and playback.
3. Interrupt the upload during the approved recovery window, reconnect, and verify one retained answer and one accepted response.
4. Reload during recovery, reopen the result, and replay its own recording. Check backgrounding, screen lock and audio-route changes.
5. Exercise login, exam load, legacy answer save, resume and submit from the released desktop app.
