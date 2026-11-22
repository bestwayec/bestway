# Exam Builder — JSON import, templates and export (teacher guide)

## Import an exam from JSON

1. **Exam Builder → Import JSON.**
2. **Source.** Either
   - choose **IELTS** or **CEFR Multilevel**, then **Full mock / Listening / Reading / Writing /
     Speaking**, pick a template and press **Load template** (or **Copy** / **Download JSON** to
     give it to an AI assistant or a colleague), or
   - paste JSON, drop a `.json` file on the editor, or **Choose file** (max 2 MiB).
   **Format JSON** indents pasted text. **Ctrl/⌘ + Enter** checks it.
3. **Check import.** A syntax mistake is shown as *JSON syntax error at line X, column Y* —
   **Show in editor** puts the cursor there. Otherwise the server checks the package and shows:
   - the exam type, kind (full exam / single skill), every section with its question count,
     numbering range and minutes;
   - **Must fix before import** — import is not possible until these are fixed;
   - **Draft allowed — blocks publish** — the draft is created, but publishing stays blocked
     (templates always land here: replace every `REPLACE` placeholder and sample key).
   Each problem names its place, e.g. `Reading › group 2 “Passage 1” › Q5 › correctAnswers`.
4. **Destination.** *Create a new exam*, or an editable draft of the **same exam type**. Drafts
   of another type are greyed out. Adding to a draft keeps everything already there; questions
   in a skill the draft already has are appended and duplicate numbers are refused. To swap a
   section instead (e.g. a corrected Reading), tick **Replace the existing … section(s)**: everything
   in those sections (questions, passages, keys, attached audio/images) is replaced by the package;
   other sections stay. Only for unpublished drafts no student has started.
5. **Media.** Optionally attach the listed audio/image files now; otherwise attach them later in
   the editor. A file marked *required* blocks publishing until it is attached.
6. **Create draft / Add to selected exam.** The import is all-or-nothing. **Open in Exam Builder**
   continues editing. Nothing is ever published by an import.

From inside a draft, **Import JSON** opens the same dialog with that draft already selected.

## Templates

| Family | Templates |
|---|---|
| IELTS | Academic full mock (4 skills); Listening full and Parts 1–4; Academic Reading full and Passages 1–3; Academic Writing (Task 1 visual + Task 2); General Training Writing (letter + essay); Speaking Parts 1–3 |
| CEFR Multilevel | Full mock (4 sections, 195 min); Listening (6 parts / 35); Reading (5 parts / 35); Writing (Tasks 1.1, 1.2, 2); Speaking (Parts 1.1, 1.2, 2, 3) |

Multilevel templates follow BestWay's configured Multilevel blueprint (the same one the
editor's publish check uses). It is a platform setting, not an official specification document.

## Export

- **Exam list → Export JSON** (download icon) or **editor → Export JSON**.
- Choose **Whole exam** or one skill. The file contains the answer keys — share it with staff
  only. Audio and images are listed by file name, not embedded: after re-importing, attach them
  again (Listening audio is required before publishing).
- The file can be imported again unchanged, as a new exam or into another draft of the same type.

## Publishing

Publishing is a separate, explicit step in the editor. It stays blocked while any readiness
item fails (missing audio, open review issues, placeholder keys, wrong structure for a full mock).
