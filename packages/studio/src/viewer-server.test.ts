import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStudioViewerArguments, startStudioViewerServer, type StudioViewerServer } from './viewer-server.js';

const temporaryDirectories: string[] = [];
const servers: StudioViewerServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function sendRawRequest(server: StudioViewerServer, request: string): Promise<string> {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = connect({
      host: server.url.hostname,
      port: Number(server.url.port),
    });
    let response = '';

    socket.setEncoding('utf8');
    socket.once('connect', () => socket.end(request));
    socket.on('data', (chunk: string) => {
      response += chunk;
    });
    socket.once('end', () => resolveResponse(response));
    socket.once('error', rejectResponse);
  });
}

describe('Studio viewer server', () => {
  it('serves the packaged viewer and its assets over HTTP', async () => {
    // Given: a packaged viewer directory containing its entry document and module asset.
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    temporaryDirectories.push(viewerDirectory);
    await mkdir(join(viewerDirectory, 'assets'));
    await writeFile(join(viewerDirectory, 'index.html'), '<div id="app"></div><script type="module" src="./assets/viewer.js"></script>');
    await writeFile(join(viewerDirectory, 'assets', 'viewer.js'), 'document.querySelector("#app").textContent = "Studio";');

    // When: the viewer is launched on an ephemeral local port.
    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);
    const [documentResponse, assetResponse] = await Promise.all([
      fetch(server.url),
      fetch(new URL('assets/viewer.js', server.url)),
    ]);

    // Then: a browser can receive the HTML entry and module asset through HTTP.
    expect(documentResponse.headers.get('content-type')).toContain('text/html');
    await expect(documentResponse.text()).resolves.toContain('id="app"');
    expect(assetResponse.headers.get('content-type')).toContain('text/javascript');
    await expect(assetResponse.text()).resolves.toContain('textContent');
  });

  it('rejects invalid launch arguments before starting a server', () => {
    // Given: a command line with a non-numeric port.
    const arguments_ = ['--port', 'not-a-port'];

    // When / Then: parsing reports a user-actionable input error.
    expect(() => parseStudioViewerArguments(arguments_)).toThrow('Invalid port');
  });

  it('reports help without starting a server', () => {
    // Given: the documented help option.
    const arguments_ = ['--help'];

    // When: parsing the command line.
    const result = parseStudioViewerArguments(arguments_);

    // Then: the CLI can print its supported launch contract and exit.
    expect(result).toEqual({ kind: 'help' });
  });

  it('does not follow a packaged asset symlink outside the viewer directory', async () => {
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-outside-'));
    temporaryDirectories.push(viewerDirectory, outsideDirectory);
    const secretPath = join(outsideDirectory, 'secret.txt');
    await writeFile(secretPath, 'must not be served');
    await symlink(secretPath, join(viewerDirectory, 'escaped.txt'));

    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);

    const response = await fetch(new URL('escaped.txt', server.url));

    expect(response.status).toBe(404);
  });

  it('accepts only GET and HEAD requests for packaged viewer assets', async () => {
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    temporaryDirectories.push(viewerDirectory);
    await writeFile(join(viewerDirectory, 'index.html'), '<div id="app"></div>');

    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);
    const [headResponse, postResponse] = await Promise.all([
      fetch(server.url, { method: 'HEAD' }),
      fetch(server.url, { method: 'POST' }),
    ]);

    expect(headResponse.status).toBe(200);
    await expect(headResponse.text()).resolves.toBe('');
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.get('allow')).toBe('GET, HEAD');
  });

  it('returns 400 without an unhandled rejection for malformed raw request targets', async () => {
    // Given: a packaged viewer server and a raw request target that URL cannot parse.
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    temporaryDirectories.push(viewerDirectory);
    await writeFile(join(viewerDirectory, 'index.html'), '<div id="app"></div>');
    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);
    let unhandledRejection: unknown;
    const captureUnhandledRejection = (reason: unknown): void => {
      unhandledRejection = reason;
    };
    process.once('unhandledRejection', captureUnhandledRejection);

    try {
      // When: a raw socket sends the malformed target.
      const response = await sendRawRequest(server, 'GET // HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));

      // Then: the client receives a controlled response and no Promise rejects unhandled.
      expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/u);
      expect(unhandledRejection).toBeUndefined();
    } finally {
      process.off('unhandledRejection', captureUnhandledRejection);
    }
  });
});
