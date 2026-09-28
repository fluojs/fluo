import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium } from '@playwright/test';

import { SONGS } from '../fixture/domain.mjs';

const base = process.env.BENCHMARK_BASE_URL;
if (!base) throw new Error('Set BENCHMARK_BASE_URL to a running production fixture.');

test('production browser retains the usable jukebox resource across views', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('/jukebox/songs', base).href);
    const resource = page.locator('[data-testid="jukebox-resource"]');
    const identity = await resource.evaluate((element) => new Promise((resolve, reject) => {
      const current = element.getAttribute('data-instance');
      if (current && current !== 'initializing') return resolve(current);
      const observer = new MutationObserver(() => {
        const value = element.getAttribute('data-instance');
        if (value && value !== 'initializing') {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(value);
        }
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Jukebox resource did not mount.'));
      }, 5000);
      observer.observe(element, { attributes: true, attributeFilter: ['data-instance'] });
    }));
    assert.ok(identity);
    for (const song of SONGS) {
      await page.getByText(song.title).first().waitFor({ state: 'visible' });
    }

    const previousAck = await page.locator('[data-testid="jukebox-ack"]').textContent();
    await page.locator('[data-testid="jukebox-ack"]').evaluate((element, prior) => {
      window.__waitForAck = new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => {
          const value = element.textContent;
          if (value && value !== prior) {
            observer.disconnect();
            clearTimeout(timeout);
            resolve(value);
          }
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Jukebox operation did not acknowledge.'));
        }, 5000);
        observer.observe(element, { childList: true, characterData: true, subtree: true });
      });
    }, previousAck);
    await page.locator('[data-testid="jukebox-operation"]').click();
    await page.evaluate(() => window.__waitForAck);

    for (const view of ['qr', 'queue', 'songs']) {
      await page.locator(`a[href="/jukebox/${view}"]`).first().click();
      await page.waitForURL(new URL(`/jukebox/${view}`, base).href);
      assert.equal(await resource.getAttribute('data-instance'), identity);
      await page.locator('[data-testid="jukebox-operation"]').click();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('production browser completes native sign-in and product CRUD', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('/login', base).href);
    await page.locator('input[name="username"]').fill('editor');
    await page.locator('input[name="password"]').fill('benchmark-pass');
    const signedIn = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/login' && response.request().method() === 'POST');
    await page.locator('form button[type="submit"]').first().click();
    assert.equal((await signedIn).status(), 303);
    await page.waitForURL(/\/admin\/products$/u);

    await page.locator('form[action="/products"] input[name="name"]').fill('Browser created item');
    const created = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/products' && response.request().method() === 'POST');
    await page.locator('form[action="/products"] button[type="submit"]').click();
    assert.equal((await created).status(), 303);
    await page.waitForURL(/\/products\/sku-\d+$/u);
    const detail = new URL(page.url()).pathname;
    await page.getByText('Browser created item').first().waitFor({ state: 'visible' });

    const editForm = page.locator('form').filter({ has: page.locator('input[name="name"]') });
    await editForm.locator('input[name="name"]').fill('Browser updated item');
    const updated = page.waitForResponse((response) =>
      new URL(response.url()).pathname === detail && response.request().method() === 'POST');
    await editForm.locator('button[type="submit"]').click();
    assert.equal((await updated).status(), 303);
    await page.getByText('Browser updated item').first().waitFor({ state: 'visible' });

    const deleted = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `${detail}/delete` && response.request().method() === 'POST');
    await page.locator(`form[action="${detail}/delete"] button[type="submit"]`).click();
    assert.equal((await deleted).status(), 303);
    assert.equal((await page.request.get(new URL(detail, base).href)).status(), 404);
    await page.goto(new URL('/admin/products', base).href);
    const signedOut = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/logout' && response.request().method() === 'POST');
    await page.locator('form[action="/logout"] button[type="submit"]').first().click();
    assert.equal((await signedOut).status(), 303);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
