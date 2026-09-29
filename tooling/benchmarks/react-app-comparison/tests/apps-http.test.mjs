import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRODUCTS, SONGS, SESSION_COOKIE } from '../fixture/domain.mjs';

const base = process.env.BENCHMARK_BASE_URL;
if (!base) throw new Error('Set BENCHMARK_BASE_URL to a running production fixture.');

const request = (path, options = {}) =>
  fetch(new URL(path, base), { redirect: 'manual', ...options });
const post = (path, fields, cookie) =>
  request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });

test('anonymous listing and detail use the same public seed', async () => {
  const list = await request('/');
  assert.equal(list.status, 200);
  const html = await list.text();
  for (const product of PRODUCTS) {
    assert.ok(html.includes(product.name), `missing ${product.name}`);
    assert.ok(html.includes(`/products/${product.sku}`), `missing ${product.sku} detail link`);
    const detail = await request(`/products/${product.sku}`);
    assert.equal(detail.status, 200);
    assert.ok((await detail.text()).includes(product.name));
  }
  assert.equal((await request('/products/not-found')).status, 404);
});

test('anonymous and invalid mutations fail before modifying the catalog', async () => {
  const response = await post('/products', { name: 'Forbidden item' });
  assert.equal(response.status, 403);
  const listing = await request('/');
  assert.equal((await listing.text()).includes('Forbidden item'), false);
});

test('login and protected create, edit, delete use native redirects and no-store', async () => {
  const rejected = await post('/login', { username: 'editor', password: 'incorrect' });
  assert.equal(rejected.status, 401);
  const login = await post('/login', { username: 'editor', password: 'benchmark-pass' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie');
  assert.ok(cookie?.includes(`${SESSION_COOKIE}=`));
  assert.match(cookie, /httponly/iu);
  assert.match(cookie, /samesite=lax/iu);
  const session = cookie.split(';')[0];

  const invalid = await post('/products', { name: 'x' }, session);
  assert.equal(invalid.status, 400);
  const created = await post('/products', { name: 'Created product' }, session);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const location = created.headers.get('location');
  assert.match(location ?? '', /^\/products\/sku-\d+$/u);
  const detail = await request(location, { headers: { cookie: session } });
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.ok((await detail.text()).includes('Created product'));

  const updated = await post(location, { name: 'Updated product' }, session);
  assert.equal(updated.status, 303);
  const refreshed = await request(location, { headers: { cookie: session } });
  assert.ok((await refreshed.text()).includes('Updated product'));
  const deleted = await post(`${location}/delete`, {}, session);
  assert.equal(deleted.status, 303);
  assert.equal((await request(location)).status, 404);
  const logout = await post('/logout', {}, session);
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie') ?? '', /max-age=0/iu);
});

test('jukebox views expose the shared song dataset and navigation', async () => {
  for (const view of ['songs', 'qr', 'queue']) {
    const response = await request(`/jukebox/${view}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const song of SONGS) assert.ok(html.includes(song.title), `${view} omits ${song.title}`);
    for (const destination of ['songs', 'qr', 'queue']) {
      assert.ok(html.includes(`/jukebox/${destination}`), `${view} omits ${destination} navigation`);
    }
  }
});
