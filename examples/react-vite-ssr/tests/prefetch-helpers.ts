import { expect, type Page, type Response } from '@playwright/test';

const NAVIGATION_ACCEPT = 'application/vnd.fluo.react-navigation+json;v=2';

export function createDeferredSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

export function observeNavigation(page: Page, pathname: string): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET'
      && new URL(request.url()).pathname === pathname
      && request.headers().accept === NAVIGATION_ACCEPT) {
      requests.push(request.url());
    }
  });
  return requests;
}

export function nextNavigation(page: Page, pathname: string): Promise<Response> {
  return page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === pathname
    && response.request().headers().accept === NAVIGATION_ACCEPT);
}

export async function openHydratedAdmin(page: Page, query = ''): Promise<void> {
  await page.goto(`/admin/qr${query}`);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
}
