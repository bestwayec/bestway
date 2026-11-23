# Vocabulary pronunciation engine (Learning 3.0)

One shared engine for every vocabulary surface: `frontend/src/lib/pronunciation/engine.ts`
(framework-free) and `frontend/src/lib/pronunciation/react.tsx` (hook, button, settings).

## Behaviour

| Rule | How |
|---|---|
| Two plays by default | `repeat` 1 / 2 / 3 (default 2); play *n+1* starts only after play *n* ended (`ended` / `onend`) plus a pause (default **650 ms**). Measured in the browser: 650–651 ms. |
| Never overlapping | One app-wide engine (`getPronunciationEngine()`). Every `play()` cancels the running sequence first. Repeated clicks: only the last sequence plays. |
| No stale callbacks | Each sequence has a token; every timer, `ended`, `onend`, `onerror` checks it. A cancelled pause or play settles immediately. |
| Question change / unmount | `usePronunciation(resetKey)` stops the playback it started when `resetKey` changes or the component unmounts — owner-scoped, so it never stops another component's audio. |
| Sources | 1. the word's stored `audioUrl` (teacher-provided HTTPS file, played by `HTMLAudioElement`); 2. the browser Web Speech API. No paid TTS. If the stored file fails, the engine falls back to speech for the remaining plays. |
| Speed | normal / slow: audio `playbackRate` 1 / 0.75 (pitch preserved); speech rate 0.95 / 0.6. |
| Accent | auto / British / American *if available*. The engine reports the voice language actually used (`voiceLang`) and `accentFallback`; it never labels an American voice as British. |
| IPA | Shown only when the teacher entered it, and never on listening questions (it would hint the answer). |
| Autoplay policy | Not bypassed. A blocked start is reported as `blocked` ("Tap the speaker to play"). The quiz auto-plays only after the learner's first tap/key press; before that the speaker button reads "Start listening". |
| Engine never fires `end` | A watchdog (≥ 4 s, scaled by text length) resolves the play so the sequence cannot hang; it never starts an extra play. |
| Settings | `enabled` (auto-play), repeat, speed, accent — stored per browser in `localStorage` (try/catch; private mode falls back to defaults). |

## Where it is used

| Surface | Before | Now |
|---|---|---|
| `VocabularyQuizRunner` | own `speechSynthesis`, one play, read *any* prompt (incl. Uzbek text) | shared engine; only where the English word is not the answer |
| Flashcards (`VocabularyAssignment`) | own `<audio>` + speech, one play | `PronounceButton` (stored audio first) |
| Teacher builder (`VocabularyBuilder`) | none | preview per word, shows "stored audio" vs "browser voice" |
| Vocab Battle host | own speech, one play | shared engine, two plays |
| Exam click-to-vocab (`ClickToVocabWrapper`) | own speech | shared engine |

## Answer integrity

- Questions that ask for the English word (`uzb_eng`, `spelling`, `fill_blank`) get no audio, no
  IPA and — fixed in this release — no example sentence (the server used to send the sentence,
  which contains the word, for every type).
- Listening questions hide the word and IPA on screen. **Limitation:** with browser speech the
  word text must reach the browser (`speak` field), and a stored `audioUrl` may contain the word.
  Listening questions are therefore practice-grade, not secure high-stakes assessments; the
  server still grades from its own snapshot, never from client claims.

## Tests

- `engine.spec.ts` (15, fake audio/speech + fake timers): exactly two sequential plays; pause;
  1/3 repeats; slow rate; stop; new word cancels old; repeated clicks; owner-scoped stop;
  audio-error fallback; error without speech; unsupported; blocked autoplay; silent engine;
  voice choice.
- `react.spec.ts` (5, jsdom): click plays with settings; auto-play only when allowed; stop on
  question change and unmount (owner-scoped); settings parsing; no speech for answer-revealing types.
- `scripts/e2e-local/vocab-learning-3.mjs` (23, real Chromium): stored audio via a real
  `HTMLAudioElement`, speech via a deterministic logger; counts and order of every play.
