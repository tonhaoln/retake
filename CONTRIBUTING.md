# Contributing

Retake is small on purpose: a Swift CLI that records, and an editor that ships
as one self-contained HTML file. The sources behind it are short enough to read
in an afternoon, and that smallness is a feature worth protecting.

## Start here

Bug fixes need no permission. Send them.

For a feature, open an issue first. The rules below are what this project
deliberately says no to, and a five-minute conversation beats a rejected pull
request.

## Running the tests

```
cd test
npm install
npx playwright install chromium
node ../Editor/build.js     # always build first, the tests load the built file
npm test
```

Every `*.test.mjs` file is a gate and CI runs all of them on every pull
request. `shot-*.mjs` files are screenshot helpers, not gates. If you touch
the editor, the whole suite has to pass.

**A gate has to be capable of failing.** A test that cannot fail is
documentation. This suite ran green for days on assertions that could not
come out false, so if you add a gate, break the thing it guards and watch it
go red before you send it.

## Editing the editor

`retake-editor.html` at the repo root is a **build artifact**. Edit the
sources instead:

- `Editor/retake-editor.html`, markup and CSS
- `Editor/app.js`, logic

Then run `node Editor/build.js` and copy the dist over the root file.

**What ships has to be what you can read.** Nothing is minified, every bundled
library keeps its notice and its upstream URL, and CI rebuilds the editor from
source and byte-compares it against the committed file. A hand-edited root
file fails the build. That is what keeps "audit it yourself" a real offer.

## The two rules that don't bend

1. **The source video is sacred.** Cuts, zooms and crops are data mapped at
   render time. No edit operation may mutate or re-encode the recording.
2. **Nothing leaves the machine.** No analytics, no network calls, no
   telemetry, ever. The recorder logs key *timings*; actual keystrokes only
   behind the explicit `--keys` flag.

Anything that breaks either one won't be merged, however good it is.

These two are the headline. The full set of load-bearing rules — thirteen,
with their reasoning — lives in [CLAUDE.md](CLAUDE.md); read it before a
non-trivial change.
