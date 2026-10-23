import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function demo(page: Page, persona: 'student' | 'driver' | 'admin') {
  await page.goto('/login');
  await page.getByRole('button', { name: `Demo ${persona}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(persona === 'student' ? '/live' : `/${persona}`));
}
async function endAbandoned(context: BrowserContext) {
  const auth = await (await context.request.get('/api/v1/auth/me')).json();
  if (auth.user?.role !== 'DRIVER') return;
  const active = await (await context.request.get('/api/v1/driver/trips/active')).json();
  if (active.item)
    await context.request.post(`/api/v1/driver/trips/${active.item._id}/end`, {
      data: {},
      headers: { Origin: 'http://localhost:5173', 'X-CSRF-Token': auth.csrfToken },
    });
}

test('real seeded route explorer, duplicate timetable, responsive Bengali layout and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.route-card')).toHaveCount(17);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('textbox', { name: 'Search routes' }).fill('choitali');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await page.locator('.route-card').click();
  await expect(page.getByRole('heading', { name: 'চৈতালী', exact: true })).toBeVisible();
  await expect(page.locator('.schedule-row')).toHaveCount(8);
  await expect(page.locator('.schedule-row').filter({ hasText: '7:10 AM' })).toHaveCount(2);
  await expect(page.getByText('Schedule needs confirmation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ডাউন · DOWN', exact: true }).click();
  await expect(page.locator('.schedule-row')).toHaveCount(8);
  await expect(
    page.getByText('No approved physical bus has been confirmed for this route.'),
  ).toBeVisible();
});

test('academic email errors are actionable and protected pages require login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('DU academic email').fill('student@gmail.com');
  await page.locator('form').first().getByRole('button').click();
  await expect(page.getByRole('alert')).toContainText('academic email');
  await expect(page).toHaveURL(/\/login/);
});

test('two isolated browser sessions: driver foreground GPS -> student live map -> recovered trip -> end', async ({
  browser,
}) => {
  const driverContext = await browser.newContext({
    geolocation: { latitude: 23.727, longitude: 90.402, accuracy: 8 },
    permissions: ['geolocation'],
  });
  const studentContext = await browser.newContext();
  const driver = await driverContext.newPage(),
    student = await studentContext.newPage();
  try {
    await demo(driver, 'driver');
    await endAbandoned(driverContext);
    await driver.reload();
    await expect(driver.getByRole('button', { name: /Start Trip ·/ })).toBeEnabled();
    await driver.getByRole('button', { name: /Start Trip ·/ }).click();
    await driver.getByRole('button', { name: 'Confirm Start Trip', exact: true }).click();
    await expect(driver.getByRole('button', { name: /End Trip ·/ })).toBeVisible();
    await expect(driver.getByText(/GPS accepted ·/)).toBeVisible({ timeout: 20000 });
    await student.route('https://tile.openstreetmap.org/**', (route) => route.abort());
    await demo(student, 'student');
    await expect(student.getByTestId('live-coordinates')).toHaveText('23.727000, 90.402000', {
      timeout: 15000,
    });
    await expect(student.getByText(/Map tiles unavailable/)).toBeVisible();
    await driver.bringToFront();
    await expect.poll(() => driver.evaluate(() => document.visibilityState)).toBe('visible');
    await driverContext.setGeolocation({ latitude: 23.72705, longitude: 90.40205, accuracy: 8 });
    // A later callback after the foreground report throttle must reach the socket viewer.
    await driver.waitForTimeout(6200);
    await driverContext.setGeolocation({ latitude: 23.7271, longitude: 90.4021, accuracy: 8 });
    await expect(student.getByTestId('live-coordinates')).toHaveText('23.727100, 90.402100', {
      timeout: 15000,
    });
    await driver.reload();
    await expect(driver.getByRole('button', { name: /End Trip ·/ })).toBeVisible();
    await driver.getByRole('button', { name: /End Trip ·/ }).click();
    await expect(student.getByTestId('live-coordinates')).toHaveCount(0, { timeout: 15000 });
    await expect(student.locator('.trip-card')).toHaveCount(0);
    await expect(student.getByText(/Driver sharing has ended/)).toBeVisible();
  } finally {
    await endAbandoned(driverContext);
    await driverContext.close();
    await studentContext.close();
  }
});

test('admin account opens actual driver and fleet controls', async ({ page }) => {
  await demo(page, 'admin');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'চালক · Drivers', exact: true }).click();
  await expect(page.getByText(/Development driver/).first()).toBeVisible();
});
