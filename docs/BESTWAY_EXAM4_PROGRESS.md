# Bestway Exam System 4.0 progress

## Phase 1 · Exam reliability

The reliability branch starts at `9c37f60c0b23c7e6e0cde254632da7cdd9c281c1`, the fetched `origin/main`. Phase 1 covers autosave, attempt recovery, section transitions, hand-in, and playback. [Phase 1 report](BESTWAY_EXAM4_PHASE1_REPORT.md)

- The web runner sends changed responses with the server revision the student saw. It keeps each edit until a matching receipt arrives and asks the student to resolve conflicts explicitly.
- The browser keeps unsent edits by attempt, question, and writer. It reports storage failures and keeps recoverable edits available after a hand-in or section closure.
- The server serializes saves, session takeover, advance, and hand-in against the attempt row. A repeated advance targets the same section, and a repeated hand-in returns the existing result.
- Speaking upload status requires a saved receipt. The server measures new recordings, protects existing media on rejected uploads, and supports authorized byte-range playback.

## Integration handoff

Phase 4 should verify the final candidate against a deployment-equivalent PostgreSQL and shared Redis stack. Check the health endpoint's build commit, mobile recording and playback, and compatibility with the released desktop client before approving a deployment. Keep the backend and web revision contract in the same coordinated release.

## Phase 2 · Canonical exam content

Phase 2 uses existing Reading stimulus references and IELTS Listening part numbers to share sources across question groups. Draft authoring, JSON packages, preview and candidate navigation use those associations. [Phase 2 report](BESTWAY_EXAM4_PHASE2_REPORT.md)
