# Test suite

Playwright end-to-end tests against the BUILT editor (Editor/dist-openstudio-editor.html).

    npm install
    node ../Editor/build.js   # ALWAYS build before testing (runs from any cwd)
    npm test                  # or: node test12.mjs etc.

Tests use Playwright's own Chromium: run `npx playwright install chromium` once.
Known limitation: the tests carry absolute paths to this machine's checkout, so a
clean checkout elsewhere needs them made relative first. Fixture is VP9/Opus because
Playwright's Chromium lacks H.264/AAC; regenerate with ./make-fixture.sh.
test8/shot-*.mjs are screenshot helpers, not gates.
