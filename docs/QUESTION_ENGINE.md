# Shared objective question formats

The engine reuses `MockQuestionType` scoring primitives. Layout and answer rules
describe the authored interaction without adding equivalent question enums.

| Format | Stored question type | Metadata |
| --- | --- | --- |
| Multiple choice | `multiple_choice` | Per-question options |
| Short answer | `short_answer` | Existing word limit |
| One-word gap fill | `short_answer` | `answerRule: ONE_WORD`, numbered gaps |
| Note completion | `note_completion` | `contentLayout: notes`, answer rule |
| Sentence completion | `sentence_completion` | `contentLayout: sentences`, answer rule |
| True / False / Not Given | `true_false_notgiven` | Canonical decision key |
| Matching | `matching` | Shared bank, `optionsReusable` |
| Heading match | `matching_headings` | `contentLayout: headings` |
| Speaker match | `matching` | `contentLayout: speakers` |
| Short-text match | `matching` | `contentLayout: short_texts` |
| Paragraph match | `matching` | `contentLayout: paragraphs` |
| Map / plan label | `map_labelling` | Secure group image and optional bank |
| Multi-extract MCQ | `multiple_choice` | `contentLayout: multi_extract`, separate group/audio per extract |

`optionsReusable` is nullable: null preserves legacy client behavior, false
requires distinct mappings, and true permits repeated options. Group matching
banks are stored in each question's existing `options` array. Extra unused
options are permitted. Explicit one-use duplicate responses score zero.

`ONE_WORD` and `ONE_WORD_AND_OR_NUMBER` use trim, Unicode/case normalization and
explicitly authored accepted alternatives. The latter permits at most one text
token and one numeric token (for example `gate 7`). An explicit rule takes
precedence over the legacy `wordLimit`. A null rule preserves the original IELTS
text normalization and word-limit behavior. Choice grading resolves both import
letter keys and the existing option-text response wire. Decision aliases such as
`NO_INFORMATION` normalize to `NOT_GIVEN`; clients may display `NOT GIVEN`.

`practiceLevel` is a nullable normalized A1/A2/B1/B2/C1 content field, independent
of free-text `level`, calibrated difficulty, and full Multilevel result levels.

Draft block saves permit incomplete prompts, answer keys and banks. Publication
requires complete questions, valid mappings, passage/audio/image requirements,
available secure media and exact numbered gap mappings. Practice can use the
broader engine; only `full_mock` invokes the immutable Multilevel blueprint.
Student payload shaping exposes interaction metadata and never answer keys,
accepted alternatives or staff transcripts.
