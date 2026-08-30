import { request } from 'node:http';

import { describe, expect, it } from 'vitest';

import { type StudioSidecar, startStudioSidecar } from './sidecar.js';

type SidecarResponse = {
  readonly body: string;
  readonly contentType: string | undefined;
  readonly status: number;
};

function requestSidecar(sidecar: StudioSidecar, path: string, token?: string): Promise<SidecarResponse> {
  return new Promise((resolve, reject) => {
    const client = request({
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      host: sidecar.host,
      method: 'GET',
      path,
      port: sidecar.port,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.once('end', () => {
        resolve({
          body,
          contentType: response.headers['content-type'],
          status: response.statusCode ?? 0,
        });
      });
    });
    client.once('error', reject);
    client.end();
  });
}

describe('Studio viewer sidecar request security', () => {
  it('returns a client error for malformed paths and continues serving', async () => {
    // Given a running packaged viewer sidecar.
    const sidecar = await startStudioSidecar({ heartbeatMs: 0 });

    try {
      // When a client sends an authority-like malformed request target.
      const malformed = await requestSidecar(sidecar, '//');
      const healthy = await requestSidecar(sidecar, '/', sidecar.token);

      // Then it receives a safe client error while subsequent viewer requests continue.
      expect(malformed.status).toBe(400);
      expect(healthy.status).toBe(200);
    } finally {
      await sidecar.close();
    }
  });

  it('brackets an IPv6 listener URL and serves the viewer through it', async () => {
    // Given a sidecar bound to the IPv6 loopback interface.
    const sidecar = await startStudioSidecar({ heartbeatMs: 0, host: '::1' });

    try {
      // When callers consume the generated listener URL.
      const response = await requestSidecar(sidecar, '/', sidecar.token);

      // Then the URL is parseable and the viewer remains reachable over IPv6.
      expect(sidecar.url).toBe(`http://[::1]:${String(sidecar.port)}`);
      expect(response.status).toBe(200);
    } finally {
      await sidecar.close();
    }
  });

  it('serves only packaged assets before applying authorization', async () => {
    // Given a running viewer sidecar and its tokenized HTML shell.
    const sidecar = await startStudioSidecar({ heartbeatMs: 0 });

    try {
      const shell = await requestSidecar(sidecar, '/', sidecar.token);
      const assetNames = [...shell.body.matchAll(/(?:href|src)="\.\/assets\/([^"]+)"/g)].map((match) => match[1] ?? '');
      const protectedPaths = [
        '/assets/%2e%2e%2findex.html',
        '/assets/%2e%2e%2fcontracts.js',
        '/assets/index.d.ts',
        '/assets/contracts.js',
      ];

      // When unauthenticated callers request viewer assets and traversal-like paths.
      const assets = await Promise.all(assetNames.map((assetName) => requestSidecar(sidecar, `/assets/${assetName}`)));
      const unauthenticated = await Promise.all(protectedPaths.map((path) => requestSidecar(sidecar, path)));
      const authenticated = await Promise.all(protectedPaths.map((path) => requestSidecar(sidecar, path, sidecar.token)));

      // Then JavaScript and CSS remain available while paths outside the assets namespace stay protected.
      expect(assetNames.some((assetName) => assetName.endsWith('.js'))).toBe(true);
      expect(assetNames.some((assetName) => assetName.endsWith('.css'))).toBe(true);
      expect(assets.every((asset) => asset.status === 200)).toBe(true);
      expect(unauthenticated.map((response) => response.status)).toEqual([401, 401, 401, 401]);
      expect(authenticated.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    } finally {
      await sidecar.close();
    }
  });
});
