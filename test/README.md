# Test suite

Playwright end-to-end tests against the BUILT editor (Editor/dist-openstudio-editor.html).

    npm install
    node ../Editor/build.js   # ALWAYS build before testing
    npm test                  # or: node test12.mjs etc.

The chromium `executablePath` in each test points at a sandbox path — replace with
your local Chromium/Chrome path (or remove the option to use Playwright's default;
run `npx playwright install chromium` once). Fixture is VP9/Opus because
Playwright's Chromium lacks H.264/AAC; regenerate with ./make-fixture.sh.
test8/shot-*.mjs are screenshot helpers, not gates.
