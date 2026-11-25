# Exam JSON package — schema 1.0

The one JSON format the Exam Builder imports and exports. The server is the authority:
`backend-django/apps/core/mock_import_validate.py` (`validate_package`). The frontend repeats
some checks only for faster feedback.

## Endpoints (staff only)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/mock/exam-imports/validate` | Dry run. Returns `{checksum, issues[], counts, canImport, canPublish, …}`. Writes nothing. |
| POST | `/v1/mock/exam-imports/media` | Stage an audio/image file (24 h) for `mediaBindings`. |
| POST | `/v1/mock/exam-imports` | Commit `{package, mediaBindings?, validatedChecksum, targetExamId?, replaceExisting?}` in one transaction. 201 new, 200 replay. With `targetExamId` the package's skills are **appended** (duplicate numbers → 409); with `replaceExisting: true` the draft's sections of those skills are **replaced** (other skills untouched). Target must be an unpublished draft no student has started (409 `MOCK_CONTENT_LOCKED`) and, for teachers, their own (403). |
| GET | `/v1/mock/exam-imports/by-package/<packageId>/revisions/<n>` | Recover the draft after a timeout. |
| GET | `/v1/mock/exams/<id>/export[?skill=listening\|reading\|writing\|speaking]` | **New.** Package of the exam (or one skill). Owner teacher or admin. |

Roles: `teacher`, `admin`, `super_admin`. Students get 403 on every route above; a teacher gets
403 for another teacher's exam (export, or import into it).

## Top level

```json
{
  "schemaVersion": "1.0",          // exactly "1.0"
  "packageId": "ielts-reading-1",  // ^[a-z][a-z0-9_-]{0,79}$
  "revision": 1,                   // integer ≥ 1; same id+revision+content = replay; changed content = 409
  "profile": "practice",           // "practice" | "full_mock"
  "source": { "kind": "original_practice", "label": "Who wrote it", "notes": "optional" },
  "exam": { … },
  "media": [ … ],                  // ≤ 20 declarations
  "reviewIssues": [ … ]            // ≤ 200; any open issue blocks publishing, never import
}
```

`source.kind`: `provided_material` | `original_practice`.

## exam

| Field | Type | Notes |
|---|---|---|
| `type` | `ielts_academic` \| `ielts_general` \| `multilevel` | Must match the target draft when merging. |
| `title` | string ≥ 3 | |
| `description`, `level` | string | may be `""` |
| `practiceLevel` | `A1`…`C1` | Multilevel + `practice` only |
| `isDemo`, `isFreeForApproved` | boolean | |
| `price` | integer ≥ 0 | |
| `sections` | 1–4 sections, one per skill | |
| `isPublished` | **forbidden** | import never publishes (`PUBLISH_INJECTION`) |

## section

`{ key, skill, title, instructions, durationMinutes?, groups[1..50] }` — `skill` is
`listening|reading|writing|speaking`, once per package. `durationMinutes` 1–300.

## group

| Field | Notes |
|---|---|
| `key`, `title` | required, non-blank |
| `instructions`, `passageText`, `contentHtml`, `audioScript` | strings (may be `""`). HTML is sanitised server-side. |
| `contentLayout` | `document table notes summary sentences headings speakers short_texts paragraphs map multi_extract` |
| `optionsReusable` | boolean or null (matching banks) |
| `partNumber` | Listening only; 1–4 IELTS, 1–6 Multilevel |
| `audioPlayLimit` | 1–10 (Listening) |
| `audioRef` / `imageRef` | key of a `media` declaration of kind audio / image |
| `maxScore` | **new, optional.** Writing/Speaking part maximum (Multilevel blueprint: 5/5/6, 5/5/5/6) |
| `stimulusRef` | Optional section-scoped identity. Reading groups for one passage share a value. Writing Tasks 1.1 and 1.2 may share a stimulus. |
| `questions` | 1–200. A source group can use `[]` when a linked group in the same passage or IELTS Listening part contains questions. |

Give each Reading passage a unique `stimulusRef`. Set `passageText` on its source group and reuse its reference on continuation groups. Keep rich task documents in each group's `contentHtml`. Legacy consecutive groups repeating whitespace-normalized source text still form one passage. Review source-less continuations and conflicting source text before publication.

IELTS Listening groups with the same `partNumber` belong to one part. Supply one recording for the part. Older packages can reuse the same `audioRef` on its groups. Other groups can supply instructions, tasks, and maps. Full IELTS sections validate the number of logical units and the sum of objective scoring positions.

An exported Reading source group can contain the passage with `questions: []` when another group shares its reference and contains the questions. An IELTS Listening recording can also live on a source-only group in its numbered part. Whole-section audio markers are saved through the existing exam `audio-timestamps` endpoint. JSON packages carry media references. Reattach the file and restore its verified markers when moving a whole-section recording into another draft.

## question

| Field | Notes |
|---|---|
| `key`, `sourceRef` | required, non-blank |
| `number` | 1–200, **unique within its skill** (IELTS Listening 1–40 and Reading 1–40 may share a package) |
| `type` | `multiple_choice multi_select true_false_notgiven yes_no_notgiven matching matching_headings sentence_completion note_completion summary_completion table_completion short_answer map_labelling essay_task1 essay_task2 speaking_task` |
| `prompt` | non-blank |
| `options` | plain strings, no `A) ` prefixes; TFNG exactly `["TRUE","FALSE","NOT GIVEN"]` |
| `correctAnswers` | letters for choice types; text for completion; `[]` for essays/speaking |
| `acceptedVariants` | text answers only; no `a/b` syntax |
| `points` | 1–20; IELTS essays/speaking must be 9 |
| `wordLimit`, `answerRule` | text completion answers |
| `cefrLevel` | **new, optional.** `A1`–`C2` |
| `skillTags` | **new, optional.** ≤ 8 lowercase tags |
| `evidenceText` | **new, optional.** Must occur in the group's passage / audioscript; the offset is recomputed by the server |
| `audioStartSec` | **new, optional.** Listening only, seconds ≥ 0 |

The four *new* question fields and the two *new* group fields are additive: packages written
before them stay valid and import exactly as before.

## media

`{ key, kind: "audio"|"image", fileName, requiredForPublish, description? }`. `fileName` is a
plain basename (no paths, no URLs). Files are never embedded in JSON. Bind a staged upload with
`mediaBindings: { "<key>": "<uploadId>" }`, or attach the file later in the editor. An unbound
`requiredForPublish` declaration blocks publishing (`MISSING_MEDIA`), not import.

## Issues

Each issue: `{ code, path, message, blocks: ["import"] | ["publish"] }`. `path` is a JSON pointer
into the package (`/exam/sections/1/groups/0/questions/4/correctAnswers`); the dialog shows it
as `Reading › group 1 “…” › Q5 › correctAnswers`. Syntax errors never reach the server: the
dialog reports them as `JSON syntax error at line X, column Y`.

## Limits and safety

2 MiB per package (checked in the browser before reading a file and again on the server),
≤ 4 sections, ≤ 50 groups, ≤ 200 questions, ≤ 20 media, ≤ 500 reported issues. Duplicate JSON
object keys are rejected (both sides). Unknown fields are rejected. HTML is sanitised with an
allow-list; scripts and attributes are dropped. No code is executed; nothing is deserialised
except JSON. Imports run in one transaction (`SERIALIZABLE` outside tests): any failure saves
nothing.

## Export

`GET /mock/exams/<id>/export` produces this same schema. Guarantees (tested for every
template in `tests/test_exam_templates_and_export.py`):

- import → export → re-import → export gives identical exam content (titles, instructions,
  passages, rich HTML, tables, options, keys, variants, points, word limits, answer rules,
  part numbers, play limits, durations, max scores, stimulus refs, CEFR level, tags, evidence,
  audio timestamps, question and group order, keys);
- `sourceRef` becomes `BestWay exam <id> question <id>` (provenance);
- each distinct audio/image becomes one `media` declaration; the file itself must be bound again;
- a single-skill export of a `full_mock` exam is marked `practice`.

## Example (smallest valid package)

```json
{
  "schemaVersion": "1.0", "packageId": "demo-reading", "revision": 1, "profile": "practice",
  "source": { "kind": "original_practice", "label": "Teacher-written" },
  "exam": { "type": "ielts_academic", "title": "Demo reading", "description": "", "level": "",
    "isDemo": false, "price": 0, "isFreeForApproved": true,
    "sections": [{ "key": "reading", "skill": "reading", "title": "Reading", "instructions": "",
      "groups": [{ "key": "p1", "title": "Passage 1", "instructions": "Choose TRUE, FALSE or NOT GIVEN.",
        "passageText": "Rooftop gardens cool the buildings below them.", "contentHtml": "",
        "contentLayout": "document", "audioScript": "",
        "questions": [{ "key": "q1", "sourceRef": "teacher", "number": 1, "type": "true_false_notgiven",
          "prompt": "Rooftop gardens cool buildings.", "options": ["TRUE", "FALSE", "NOT GIVEN"],
          "correctAnswers": ["TRUE"], "acceptedVariants": [], "points": 1 }] }] }] },
  "media": [], "reviewIssues": []
}
```

All 18 dialog templates are committed as complete examples in
`backend-django/tests/fixtures/exam_import_templates/`.
