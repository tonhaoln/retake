import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');
await page.setInputFiles('#dirInput', '<repo>/test/fixture.osrec');
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => {
  pause();
  document.querySelector('#cursorStyle button[data-v="ring"]').click();
  const i0 = Math.floor(0.9 * 120), i1 = Math.floor(1.1 * 120);
  for (let i = i0; i <= i1; i++) {
    const f = (i - i0) / (i1 - i0);
    S.track.xs[i] = 200 + f * 700; S.track.ys[i] = 300;
  }
  seekTo(1.0);
});
await page.waitForTimeout(600);
const shot = await page.screenshot({ clip: { x: 120, y: 120, width: 900, height: 380 } });
await import('fs').then(fs => fs.default.writeFileSync('<repo>/test/out/21-halo-blur-fixed.png', shot));
await browser.close();
console.log('DONE11');
