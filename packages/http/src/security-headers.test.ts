import { describe, expect, it, vi } from 'vitest';

import { createSecurityHeadersMiddleware } from './security-headers.js';
import type { MiddlewareContext } from './types.js';

function createContext() {
  return {
    request: { path: '/' },
    requestContext: {},
    response: {
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader: vi.fn(),
      setStatus() {},
    },
  } as unknown as MiddlewareContext;
}

describe('createSecurityHeadersMiddleware', () => {
  it('sets security headers before calling next', async () => {
    const middleware = createSecurityHeadersMiddleware();
    const context = createContext();
    const events: string[] = [];

    context.response.setHeader = vi.fn((name: string) => {
      events.push(`header:${name}`);
    });

    await middleware.handle(context, async () => {
      events.push('next');
    });

    expect(events).toEqual([
      'header:Content-Security-Policy',
      'header:Cross-Origin-Opener-Policy',
      'header:Referrer-Policy',
      'header:Strict-Transport-Security',
      'header:X-Content-Type-Options',
      'header:X-Frame-Options',
      'header:X-XSS-Protection',
      'next',
    ]);
  });
});
