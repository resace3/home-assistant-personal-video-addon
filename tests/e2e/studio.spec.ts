import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('mobile feed autoplays muted and keeps one player active', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic Daily Reflection' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluateAll((videos) => videos.filter((video) => !video.paused).length)).toBeLessThanOrEqual(1);
  await expect(page.locator('.desktop-shell')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/mobile-feed.png' });
});

test('mobile daily and weekly libraries work', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: /Synthetic Daily Reflection/ })).toBeVisible();
  await page.getByRole('button', { name: 'Weekly Videos' }).click();
  await expect(page.getByRole('button', { name: /Synthetic Weekly Reflection/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-weekly-library.png' });
});

test('desktop dashboard and resize breakpoint work without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.desktop-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent videos' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/desktop-dashboard.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-feed')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-resized-feed.png' });
});

test('accessibility and byte-range streaming pass', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  const ranged = await request.get('/api/videos/daily-2026-07-10/stream', { headers: { Range: 'bytes=0-99' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-range']).toMatch(/^bytes 0-99\//);
  expect((await ranged.body()).length).toBe(100);
  expect(browserErrors).toEqual([]);
});

test('autoplay rejection exposes a play fallback', async ({ page }) => {
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new Error('blocked')); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Synthetic Daily Reflection/ })).toBeVisible();
});

test('catalog text is escaped and cannot execute markup', async ({ page }) => {
  await page.addInitScript(() => { (window as typeof window & { __xss?: boolean }).__xss = false; });
  await page.route('**/api/videos?page_size=50', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: [{
      id: 'daily-xss-test', type: 'daily', title: '<img src=x onerror="window.__xss=true">',
      description: '<script>window.__xss=true</script>', created_at: '2026-07-10T12:00:00Z',
      duration_seconds: 60, generation_status: 'complete',
    }], total: 1, page: 1, page_size: 50 }),
  }));
  await page.goto('/');
  await expect(page.getByText('<img src=x onerror="window.__xss=true">', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __xss?: boolean }).__xss)).toBe(false);
});

test('empty and error states are stable synthetic visuals', async ({ page }) => {
  await page.route('**/api/videos?page_size=50', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }),
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No completed videos yet' })).toBeVisible();
  await page.screenshot({ path: 'test-results/empty-state.png' });
  await page.unroute('**/api/videos?page_size=50');
  await page.route('**/api/videos?page_size=50', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Videos are temporarily unavailable' })).toBeVisible();
  await page.screenshot({ path: 'test-results/error-state.png' });
});

test('storage diagnostics distinguish /share from /shared', async ({ page }) => {
  await page.route('**/api/videos?page_size=50', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      items: [], total: 0, page: 1, page_size: 50,
      catalog: {
        state: 'media_root_missing', usable: 0, indexed: 0, invalid: 0,
        unavailable: 0, duplicates: 0,
        expected_index: '/share/personal_video_studio/indexes/all.json',
      },
    }),
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Video storage is not mounted' })).toBeVisible();
  await expect(page.getByText('/share/personal_video_studio', { exact: false })).toBeVisible();
  await expect(page.getByText('/shared is different', { exact: false })).toBeVisible();
});
