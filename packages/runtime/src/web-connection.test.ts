import { describe, expect, it } from 'vitest';
import { resolveHttpConnection } from '@fluojs/http';

import { createWebFrameworkRequest } from './web.js';

describe('createWebFrameworkRequest', () => {
  it('does not infer transport facts from an HTTPS Web Request URL', async () => {
    const request = await createWebFrameworkRequest(
      new Request('https://public.example/connection'),
      new AbortController().signal,
    );

    expect(request.connection).toBeUndefined();
    expect(resolveHttpConnection(request)).toEqual({
      clientAddress: undefined,
      host: undefined,
      hostname: undefined,
      port: undefined,
      protocol: 'http',
      proxyChain: [],
      remoteAddress: undefined,
      secure: false,
    });
  });
});
