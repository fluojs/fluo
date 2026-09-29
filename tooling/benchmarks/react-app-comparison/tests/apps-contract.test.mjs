import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  PRODUCTS,
  SONGS,
  authenticate,
  createCatalog,
  validateProduct,
} from '../fixture/domain.mjs';

const root = new URL('../', import.meta.url);
const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];

test('each production app has an independent build and start command', async () => {
  for (const framework of frameworks) {
    const file = new URL(`apps/${framework}/package.json`, root);
    assert.ok(existsSync(file), `missing ${framework} app`);
    const app = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(app.scripts.build, `${framework} has no production build`);
    assert.ok(app.scripts.start, `${framework} has no production start`);
  }
});

test('the four apps consume one seeded product and song domain', () => {
  assert.deepEqual(PRODUCTS.map(({ sku }) => sku), ['sku-42', 'sku-84', 'sku-126']);
  assert.deepEqual(SONGS.map(({ id }) => id), ['song-1', 'song-2', 'song-3']);
  const catalog = createCatalog();
  assert.deepEqual(catalog.list(), PRODUCTS);
  assert.deepEqual(catalog.detail('sku-42'), PRODUCTS[0]);
});

test('the shared mutation policy rejects anonymous and invalid writes', () => {
  assert.equal(authenticate('editor', 'benchmark-pass'), true);
  assert.equal(authenticate('editor', 'incorrect'), false);
  assert.deepEqual(validateProduct('x'), { ok: false, code: 'PRODUCT_NAME_TOO_SHORT' });
  assert.deepEqual(validateProduct('Updated item'), { ok: true, name: 'Updated item' });
});

test('the shared catalog supports authenticated create, update and delete semantics', () => {
  const catalog = createCatalog();
  const created = catalog.create('New item');
  assert.equal(catalog.detail(created.sku)?.name, 'New item');
  catalog.update(created.sku, 'Renamed item');
  assert.equal(catalog.detail(created.sku)?.name, 'Renamed item');
  catalog.delete(created.sku);
  assert.equal(catalog.detail(created.sku), undefined);
  assert.deepEqual(catalog.list(), PRODUCTS);
});
