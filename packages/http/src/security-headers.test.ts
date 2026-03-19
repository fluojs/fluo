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

  it('applies custom header values when options are provided', async () => {
    const middleware = createSecurityHeadersMiddleware({
      contentSecurityPolicy: "default-src 'none'",
      xFrameOptions: 'DENY',
    });
    const context = createContext();
    const calls: Array<[string, string]> = [];

    context.response.setHeader = vi.fn((name: string, value: string) => {
      calls.push([name, value]);
    });

    await middleware.handle(context, async () => {});

    expect(calls).toContainEqual(['Content-Security-Policy', "default-src 'none'"]);
    expect(calls).toContainEqual(['X-Frame-Options', 'DENY']);
  });

  it('skips a header when its option is set to false', async () => {
    const middleware = createSecurityHeadersMiddleware({
      strictTransportSecurity: false,
      xContentTypeOptions: false,
    });
    const context = createContext();
    const headerNames: string[] = [];

    context.response.setHeader = vi.fn((name: string) => {
      headerNames.push(name);
    });

    await middleware.handle(context, async () => {});

    expect(headerNames).not.toContain('Strict-Transport-Security');
    expect(headerNames).not.toContain('X-Content-Type-Options');
    expect(headerNames).toContain('Content-Security-Policy');
  });
});
