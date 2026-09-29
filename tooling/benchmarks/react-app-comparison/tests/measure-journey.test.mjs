import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveJourneyValue } from '../src/measure-browser.mjs';

test('uses the actual created destination for update and delete interactions', () => {
  // Given: the previous native form returned a framework-assigned product URL.
  const createdPath = '/products/sku-218';
  // When: a later journey uses the destination marker.
  const selector = resolveJourneyValue('form[action="$created/delete"] button', createdPath);
  // Then: it acts on the actual product rather than assuming a fixed counter.
  assert.equal(selector, 'form[action="/products/sku-218/delete"] button');
  assert.throws(() => resolveJourneyValue('$created', null), /created/);
});
