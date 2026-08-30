import { describe, expect, it } from 'vitest';

import { runCli } from '../index.js';
import { runStudioViewerCommand } from './viewer-command.js';

describe('Studio viewer command', () => {
  it('prints standalone viewer help when requested', async () => {
    // Given a caller asking for the Studio viewer command help.
    const stdout: string[] = [];
    const stderr: string[] = [];

    // When the caller invokes the command help.
    const exitCode = await runCli(['studio', '--help'], {
      stderr: { write: (message) => stderr.push(String(message)) },
      stdout: { write: (message) => stdout.push(String(message)) },
      updateCheck: false,
    });

    // Then the CLI describes the supported HTTP viewer launch path.
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toContain('Usage: fluo studio [options]');
  });

  it('rejects an out-of-range viewer port', async () => {
    // Given a caller selecting a port outside the TCP port range.
    const stderr: string[] = [];

    // When the caller starts the standalone viewer.
    const exitCode = await runCli(['studio', '--port', '65536'], {
      stderr: { write: (message) => stderr.push(String(message)) },
      stdout: { write: () => undefined },
      updateCheck: false,
    });

    // Then the CLI rejects the invalid boundary input before starting a server.
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('--port requires an integer from 0 through 65535.');
  });

  it('serves the packaged viewer over HTTP until shutdown', async () => {
    // Given an installed Studio viewer and an exact shutdown signal.
    const shutdown = new AbortController();
    let resolveViewerUrl: (url: string) => void = () => undefined;
    const announcedViewerUrl = new Promise<string>((resolve) => {
      resolveViewerUrl = resolve;
    });

    // When the standalone viewer server starts on an ephemeral port.
    const launched = runStudioViewerCommand(['--port', '0'], {
      stdout: {
        write: (message) => {
          const url = String(message).replace('Studio viewer: ', '').trim();
          resolveViewerUrl(url);
        },
      },
      waitForShutdown: () =>
        new Promise((resolve) => {
          shutdown.signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    });

    try {
      const url = await announcedViewerUrl;
      const response = await fetch(url, { headers: { connection: 'close' } });
      const html = await response.text();
      const scriptSource = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
      if (!scriptSource) {
        throw new Error('The packaged viewer HTML did not reference a JavaScript entry point.');
      }
      const script = await fetch(new URL(scriptSource, url), { headers: { connection: 'close' } });

      // Then the packaged React entry point is available from an HTTP origin.
      expect(response.status).toBe(200);
      expect(html).toContain('<div id="app"></div>');
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toContain('text/javascript');
      expect((await script.text()).length).toBeGreaterThan(0);
    } finally {
      shutdown.abort();
      await launched;
    }
  });
});
