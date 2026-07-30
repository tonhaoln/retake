import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');
// plain video, no bundle
await page.setInputFiles('#filesInput', '<repo>/test/fixture.osrec/screen.mp4');
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const st = await page.evaluate(() => ({ dur: S.duration.toFixed(1), cursor: !!S.cursor, segs: S.segs.length }));
console.log('PLAIN VIDEO:', JSON.stringify(st));
// add a manual zoom via double-click on timeline, then screenshot
await page.evaluate(() => { seekTo(2.5); addZoomAt(2.5); });
await page.waitForTimeout(600);
const seg = await page.evaluate(() => S.segs[0]);
console.log('MANUAL SEG:', JSON.stringify(seg));
await page.screenshot({ path: '<repo>/test/out/07-plain-video-manual-zoom.png' });
await browser.close();
console.log('DONE2');
