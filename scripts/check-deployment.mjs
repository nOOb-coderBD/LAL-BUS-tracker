import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.DEPLOYMENT_URL || 'http://localhost:8080';
const url = new URL(base);
assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
const ready = await fetch(`${base}/api/v1/health/ready`);
assert.equal(ready.status, 200, 'Real API/database readiness must pass');
for (const path of ['/', '/sw.js', '/icon.svg', '/illustrations/heritage-bus.svg']) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, `${path} must be readable by nginx`);
  assert.ok(response.headers.get('content-security-policy'), 'CSP must reach static responses');
}
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('.route-card').first().waitFor();
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).some((r) => r.active?.state === 'activated'));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const urls = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(request.url);
    return result;
  });
  assert.ok(urls.length > 0);
  assert.equal(urls.some((value) => /\/api\/|\/socket\.io\//.test(value)), false, 'Never cache private APIs/GPS');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.offline-banner').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ready: true, staticPermissions: true, securityHeaders: true, offlineShell: true, cachedAssets: urls.length, privateApiCacheEntries: 0, pageExceptions: 0 }));
} finally {
  await browser.close();
}
