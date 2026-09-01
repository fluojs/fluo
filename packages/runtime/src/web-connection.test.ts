import { describe, expect, it } from 'vitest';

import { createWebFrameworkRequest } from './web.js';

describe('createWebFrameworkRequest', () => {
  it('does not invent peer metadata for a standard Web request', async () => {
    const request = await createWebFrameworkRequest(
      new Request('https://public.example/connection', {
        headers: {
          forwarded: 'for=203.0.113.7;proto=https',
        },
      }),
      new AbortController().signal,
    );

    expect(request.connection).toBeUndefined();
  });
});
