# Speaking screen: before / after

All screenshots use synthetic accounts and the synthetic Multilevel exam built by `multilevel-full.mjs`, on the local stack.

- **before**: main `85bb957`.
- **after**: `claude/speaking-screen`.

Sizes are 1366×768, 390×844 and 360×640, light and dark. Each size has three states: ready (microphone tested), preparation, and recording. Script: `scripts/e2e-local/speaking-screens.mjs`.

The microphone is Chromium's fake device (`--use-fake-device-for-media-stream`), which beeps about once a second. It is a synthetic tone, never a person.

## What changed

| Item | Before | After |
|---|---|---|
| Preparation / response time | A number in a box ("28s") | A ring: the arc is the share of the server's window still left, with the seconds in the middle and a timer label for screen readers |
| Level while recording | Five bars bouncing on a CSS timer, whatever the student said | The microphone's real input level (Web Audio analyser). With silence the bars stay at their floor |
| The question | Text only | "Listen to the question" reads the prompt with the browser's own voice (Web Speech API). Hidden if the browser has no voice; stops when recording starts, so it is never in the answer |
| Step chips on phones | "Microphone" cut off at 390/360 px | Icon above the label on phones, fits |

## The bars follow the input

Readings during recording (`level.mjs` probe, middle bar height every 200 ms):

`12% 12% 12% 12% 38% 12% 12% 12% 12% 12% 12% 100% 12% 12% 12%`

The bars stay at the 12% floor between beeps and rise on each beep. The ready-state `<meter>` showed the same pattern:

`0 0 0 0.02 0.01 0.63 0.01 0.01 0.02 0.01 1 0.01 …`

## Not changed

- The server timing (preparation window, response window, single upload per answer).
- The automatic start of the next answer in a timed exam.
