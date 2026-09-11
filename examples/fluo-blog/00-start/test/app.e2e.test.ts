import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';

import { withCleanup } from '../../../../tooling/testing/with-cleanup.js';
import { AppModule } from '../src/app';

it.each([
  ['/health', 'ok'],
  ['/ready', 'ready'],
])('preserves the starter endpoint when %s is requested', async (path, status) => {
  // Given
  const app = await Test.createApp({ rootModule: AppModule });
  await withCleanup(async (defer) => {
    defer(() => app.close());
    // When
    const response = await app.request('GET', path).send();

    // Then
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status });
  });
});
