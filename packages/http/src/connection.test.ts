import { describe, expect, it, vi } from 'vitest';

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

  it.each([
    'for=203.0.113.7;for=198.51.100.9',
    'for=203.0.113.7;host=public.example;host=attacker.example',
    'for=203.0.113.7;proto=https;proto=http',
    'for=203.0.113.7, for=unknown',
    'for=203.0.113.7, for=_hidden',
    'for=2001:db8::1',
    'for=203.0.113.7, host=public.example',
  ])('keeps direct identity when Forwarded has an unsafe hop or duplicate parameter: %s', (forwarded) => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          forwarded,
          'x-forwarded-for': '203.0.113.7',
          'x-real-ip': '203.0.113.7',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      clientAddress: '192.0.2.10',
      protocol: 'http',
      proxyChain: [],
      remoteAddress: '192.0.2.10',
    });
  });

  it.each([
    'example.invalid',
    '999.999.999.999',
    '[2001:db8::1]trailing',
    '[2001:db8::1]:70000',
    '[2001:db8::1',
  ])('fails closed when a forwarded identity is invalid: %s', (identity) => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          forwarded: `for=${identity}`,
          'x-forwarded-for': '203.0.113.7',
          'x-real-ip': '203.0.113.7',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection.clientAddress).toBe('192.0.2.10');
  });

  it('accepts an unquoted IPv4 Forwarded identity with a port', () => {
    const connection = resolveHttpConnection(
      createRequest(
        { forwarded: 'for=203.0.113.7:4312' },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection.clientAddress).toBe('203.0.113.7');
  });

  it('does not fall through from malformed X-Forwarded-For to X-Real-IP', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          'x-forwarded-for': '203.0.113.7, invalid-address',
          'x-real-ip': '203.0.113.7',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection.clientAddress).toBe('192.0.2.10');
  });

  it('selects Forwarded metadata from the element adjacent to the trusted suffix', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          forwarded: [
            'for=203.0.113.7;host=attacker.example;proto=http',
            'for=198.51.100.9;host=proxy.example:8443;proto=https',
          ],
          'x-forwarded-host': 'legacy-attacker.example',
          'x-forwarded-proto': 'http',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      clientAddress: '198.51.100.9',
      host: 'proxy.example:8443',
      hostname: 'proxy.example',
      port: 8443,
      protocol: 'https',
      proxyChain: ['192.0.2.10'],
    });
  });

  it.each([
    {
      expected: { host: '[2001:db8::1]:0', hostname: '2001:db8::1', port: 0 },
      host: '[2001:db8::1]:0',
    },
    {
      expected: { host: undefined, hostname: undefined, port: undefined },
      host: '[2001:db8::1]trailing',
    },
    {
      expected: { host: undefined, hostname: undefined, port: undefined },
      host: 'public.example:65536',
    },
  ])('strictly parses trusted authorities: $host', ({ expected, host }) => {
    const connection = resolveHttpConnection(
      createRequest(
        { forwarded: `for=203.0.113.7;host="${host}"` },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject(expected);
  });

  it('normalizes IPv4-mapped IPv6 identities before IPv4 CIDR trust evaluation', () => {
    const connection = resolveHttpConnection(
      createRequest(
        { forwarded: 'for=203.0.113.7' },
        '::ffff:10.0.0.1',
      ),
      { trustProxy: ['10.0.0.0/8'] },
    );

    expect(connection).toMatchObject({
      clientAddress: '203.0.113.7',
      proxyChain: ['10.0.0.1'],
      remoteAddress: '10.0.0.1',
    });
  });

  it('matches IPv4-mapped IPv6 peers against mapped IPv6 CIDR rules', () => {
    const connection = resolveHttpConnection(
      createRequest(
        { forwarded: 'for=203.0.113.7' },
        '::ffff:10.0.0.1',
      ),
      { trustProxy: ['::ffff:10.0.0.0/104'] },
    );

    expect(connection).toMatchObject({
      clientAddress: '203.0.113.7',
      proxyChain: ['10.0.0.1'],
      remoteAddress: '10.0.0.1',
    });
  });

  it('honors a predicate policy with hop indexes and keeps the selected suffix immutable', () => {
    const predicate = vi.fn((address: string, index: number) => address === '192.0.2.10' && index === 0);
    const connection = resolveHttpConnection(
      createRequest(
        { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' },
        '192.0.2.10',
      ),
      { trustProxy: predicate },
    );

    expect(connection).toMatchObject({
      clientAddress: '198.51.100.9',
      proxyChain: ['192.0.2.10'],
    });
    expect(predicate).toHaveBeenCalledWith('192.0.2.10', 0);
    expect(Object.isFrozen(connection.proxyChain)).toBe(true);
  });

  it('evaluates IPv6 CIDRs and preserves embedded IPv4 zero addresses', () => {
    const ipv6 = resolveHttpConnection(
      createRequest({ forwarded: 'for="[2001:db8:1::7]"' }, '2001:db8:2::10'),
      { trustProxy: ['2001:db8:2::/48'] },
    );
    const embeddedZero = resolveHttpConnection(
      createRequest({ forwarded: 'for=203.0.113.7' }, '::ffff:0.0.0.0'),
      { trustProxy: ['0.0.0.0/0'] },
    );

    expect(ipv6.clientAddress).toBe('2001:db8:1::7');
    expect(embeddedZero).toMatchObject({
      clientAddress: '203.0.113.7',
      remoteAddress: '0.0.0.0',
    });
  });

  it('gives Forwarded precedence over legacy forwarding headers', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          forwarded: 'for=198.51.100.9;host=forwarded.example;proto=https',
          'x-forwarded-for': '203.0.113.7',
          'x-forwarded-host': 'legacy.example',
          'x-forwarded-proto': 'http',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      clientAddress: '198.51.100.9',
      host: 'forwarded.example',
      protocol: 'https',
    });
  });

  it('aligns legacy host and protocol values with the selected XFF element', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          'x-forwarded-for': '203.0.113.7, 198.51.100.9',
          'x-forwarded-host': 'attacker.example, proxy.example:8443',
          'x-forwarded-proto': 'http, https',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      clientAddress: '198.51.100.9',
      host: 'proxy.example:8443',
      hostname: 'proxy.example',
      port: 8443,
      protocol: 'https',
    });
  });

  it('ignores mismatched legacy metadata chains', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          host: 'safe.example',
          'x-forwarded-for': '203.0.113.7',
          'x-forwarded-host': 'attacker.example, public.example',
          'x-forwarded-proto': 'https, http',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      clientAddress: '203.0.113.7',
      host: 'safe.example',
      protocol: 'http',
    });
  });

  it('falls back to the direct Host header when trusted forwarded authority is malformed', () => {
    const connection = resolveHttpConnection(
      createRequest(
        {
          forwarded: 'for=203.0.113.7;host="public.example:not-a-port"',
          host: 'safe.example:443',
        },
        '192.0.2.10',
      ),
      { trustProxy: 1 },
    );

    expect(connection).toMatchObject({
      host: 'safe.example:443',
      hostname: 'safe.example',
      port: 443,
    });
  });
});
