import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');
await page.setInputFiles('#dirInput', '<repo>/test/fixture.osrec');
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
// clear old autosave state interference: fresh context anyway
await page.evaluate(() => { pause(); document.querySelector('#cursorStyle button[data-v="ring"]').click(); seekTo(1.0); });
await page.waitForTimeout(600);
await page.screenshot({ path: '<repo>/test/out/16-halo.png' });
await page.evaluate(() => { document.querySelector('#cursorStyle button[data-v="dim"]').click(); const el = document.getElementById('spotOp'); el.value = 55; el.dispatchEvent(new Event('input')); });
await page.waitForTimeout(400);
await page.screenshot({ path: '<repo>/test/out/17-dim.png' });
const labels = await page.evaluate(() => ({
  dimLabel: document.getElementById('spotOp').closest('label').firstChild.textContent,
  colorsHidden: document.getElementById('spotColors').style.display === 'none'
}));
console.log(JSON.stringify(labels));
await browser.close();
console.log('DONE7');
