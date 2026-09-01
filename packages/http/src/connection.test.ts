import { describe, expect, it } from 'vitest';

import { resolveHttpConnection } from './index.js';
import type { FrameworkRequest } from './types.js';

function createRequest(
  headers: FrameworkRequest['headers'] = {},
  remoteAddress = '198.51.100.42',
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path: '/connection',
    query: {},
    raw: {
      socket: {
        remoteAddress,
      },
    },
    url: '/connection',
  };
}

describe('resolveHttpConnection', () => {
  it('uses adapter-normalized transport metadata before opaque raw requests', () => {
    const request = createRequest({}, '198.51.100.42');
    request.connection = Object.freeze({
      protocol: 'https',
      remoteAddress: '192.0.2.10',
    });

    expect(resolveHttpConnection(request)).toMatchObject({
      clientAddress: '192.0.2.10',
      protocol: 'https',
      remoteAddress: '192.0.2.10',
      secure: true,
    });
  });

  it('keeps direct transport identity when proxy trust is disabled', () => {
    const connection = resolveHttpConnection(
      createRequest({
        forwarded: 'for=203.0.113.7;proto=https;host=public.example:8443',
        'x-forwarded-for': '203.0.113.7',
      }),
    );

    expect(connection).toEqual({
      clientAddress: '198.51.100.42',
      host: undefined,
      hostname: undefined,
      port: undefined,
      protocol: 'http',
      proxyChain: [],
      remoteAddress: '198.51.100.42',
      secure: false,
    });
    expect(Object.isFrozen(connection)).toBe(true);
  });

  it('selects the first untrusted IPv4 or IPv6 hop deterministically', () => {
    const ipv4 = resolveHttpConnection(
      createRequest(
        {
          'x-forwarded-for': '203.0.113.7, 198.51.100.9',
        },
        '192.0.2.10',
      ),
      { trustProxy: 2 },
    );
    const ipv6 = resolveHttpConnection(
      createRequest(
        {
          forwarded: 'for="[2001:db8::7]", for="[2001:db8::9]"',
        },
        '2001:db8::10',
      ),
      { trustProxy: 2 },
    );

    expect(ipv4.clientAddress).toBe('203.0.113.7');
    expect(ipv4.proxyChain).toEqual(['198.51.100.9', '192.0.2.10']);
    expect(ipv6.clientAddress).toBe('2001:db8::7');
    expect(ipv6.proxyChain).toEqual(['2001:db8::9', '2001:db8::10']);
  });

  it('uses trusted forwarding fields and fails closed on malformed input', () => {
    const trusted = resolveHttpConnection(
      createRequest(
        {
          forwarded: 'for=203.0.113.7;proto=https;host="public.example:8443"',
        },
        '192.0.2.10',
      ),
      { trustProxy: ['192.0.2.0/24'] },
    );
    const malformed = resolveHttpConnection(
      createRequest(
        {
          forwarded: 'for="203.0.113.7;proto=https',
          'x-forwarded-for': '203.0.113.7',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(trusted).toMatchObject({
      clientAddress: '203.0.113.7',
      host: 'public.example:8443',
      hostname: 'public.example',
      port: 8443,
      protocol: 'https',
      secure: true,
    });
    expect(malformed).toMatchObject({
      clientAddress: '192.0.2.10',
      protocol: 'http',
      secure: false,
    });
  });
});
