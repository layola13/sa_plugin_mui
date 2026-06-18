import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4175/index.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('PAGEERROR', err.stack || err.message));
page.on('requestfailed', (req) => console.log('REQFAIL', req.url(), req.failure()?.errorText || 'unknown'));
page.on('response', async (res) => {
  if (res.status() >= 400) console.log('HTTP', res.status(), res.url());
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log('URL', page.url());
console.log('MK_APP_COUNT', await page.locator('.mk-app').count());
console.log('APP_CHILDREN', await page.locator('#app > *').count());
console.log('BODY_TEXT_START');
console.log((await page.locator('body').innerText()).slice(0, 2000));
console.log('BODY_TEXT_END');
console.log('APP_HTML_START');
console.log((await page.locator('#app').innerHTML()).slice(0, 6000));
console.log('APP_HTML_END');
await browser.close();
