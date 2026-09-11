import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';

import { AppModule } from '../src/app';

it.each([
  ['/health', 'ok'],
  ['/ready', 'ready'],
])('preserves the starter endpoint when %s is requested', async (path, status) => {
  // Given
  const app = await Test.createApp({ rootModule: AppModule });
  try {
    // When
    const response = await app.request('GET', path).send();

    // Then
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status });
  } finally {
    await app.close();
  }
});
