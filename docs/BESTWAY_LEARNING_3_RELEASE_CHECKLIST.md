# BESTWAY Learning Experience 3.0 — release checklist

Production deployment needs **separate authorisation**. Merging to `main` runs CI and CodeQL only;
`deploy.yml` / `deploy-django.yml` are manual (`workflow_dispatch`, typed confirmation, environment
approval).

## Merged

| PR | Content | Merge commit | CI |
|---|---|---|---|
| [#222](https://github.com/bestwayec/bestway/pull/222) | Exam Builder completion | `7dc2398` | 4/4 |
| [#223](https://github.com/bestwayec/bestway/pull/223) | Pronunciation engine + Vocabulary Exam 3.0 | `40a7cfb` | 4/4 |
| PR C | Games, teacher question type | see final report | — |

## Database changes to apply at deploy time

| Change | Owner | Kind | Rollback |
|---|---|---|---|
| `20261123000000_exam_lifecycle` | Prisma | 3 nullable columns on `MockExam` | columns can stay; old code ignores them |
| `core.0027_vocabulary_question_types_3` | Django | choices only, no SQL | none needed |
| `core.0028_homework_vocabulary_mode` | Django | 1 nullable column on `HomeworkAssignment` | column can stay; old code ignores it |

All are additive. Order: Prisma migrations, then `manage.py migrate`.

## Before deploying

- [ ] Owner authorises the production deploy (separately from these merges).
- [ ] Back up the production database.
- [ ] Run the deploy workflow with the typed confirmation; apply migrations as above.
- [ ] Smoke test (synthetic account): vocabulary set → listening quiz plays twice; homework with a
      fixed type; Bamboozle 1v1 between two devices; one Vocab Battle question.
- [ ] Check a teacher's existing homework and a learner's existing results still open.

## Behaviour changes users will notice

- Pronunciation plays twice by default (settings: 1/2/3, slow, accent).
- New vocabulary question types; a teacher can fix the type for homework.
- Bamboozle "1v1 (online)" button: the server scores; each player plays on their own device.
- Vocab Battle speed bonus follows the server clock; answers after the time limit score 0.

## Known limitations

- Listening questions are practice-grade: the word, or its audio URL, reaches the browser.
- Vocab Runner's client knows each gate's answer; points come only from server replay with time
  bounds and a daily cap.
- No antonym questions (no antonym data).
