# Test suite

Playwright end-to-end tests against the BUILT editor (`Editor/dist-retake-editor.html`).

    npm install
    node ../Editor/build.js   # ALWAYS build before testing (runs from any cwd)
    npm test                  # or a single gate: node undo.test.mjs

Tests use Playwright's own Chromium: run `npx playwright install chromium` once.
All paths resolve through `paths.mjs`, so the suite runs on any checkout.
The fixture is VP9/Opus because Playwright's Chromium lacks H.264/AAC (the
editor has codec fallbacks); regenerate it with `./make-fixture.sh`.

`*.test.mjs` files are gates — `npm test` runs them all and stops on the first
failure. `shot-*.mjs` files are screenshot helpers, not gates.
