# Contributing

Retake is small on purpose: a Swift CLI that records, and one HTML file that
edits. Both are readable in an afternoon, and that is a feature worth
protecting.

## Start here

Bug fixes need no permission. Send them.

For a feature, open an issue first. The project has a north star
([NORTH-STAR.md](NORTH-STAR.md)) and a short list of things it deliberately
says no to. A five-minute conversation beats a rejected pull request.

## Running the tests

```
cd test
npm install
npx playwright install chromium
node ../Editor/build.js     # always build first — the tests load the built file
npm test
```

Every `*.test.mjs` file is a gate and CI runs all of them on every pull
request. `shot-*.mjs` files are screenshot helpers, not gates. If you touch
the editor, the whole suite has to pass.

## Editing the editor

`retake-editor.html` at the repo root is a **build artifact**. Edit the
sources instead:

- `Editor/retake-editor.html` — markup and CSS
- `Editor/app.js` — logic

Then run `node Editor/build.js` and copy the dist over the root file. CI
compares them, so a hand-edited root file fails the build.

## The two rules that don't bend

1. **The source video is sacred.** Cuts, zooms and crops are data mapped at
   render time. No edit operation may mutate or re-encode the recording.
2. **Nothing leaves the machine.** No analytics, no network calls, no
   telemetry, ever. The recorder logs key *timings*; actual keystrokes only
   behind the explicit `--keys` flag.

Anything that breaks either one won't be merged, however good it is.
