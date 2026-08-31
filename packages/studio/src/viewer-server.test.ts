import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStudioViewerArguments, startStudioViewerServer, type StudioViewerServer } from './viewer-server.js';

const temporaryDirectories: string[] = [];
const servers: StudioViewerServer[] = [];
const RAW_REQUEST_TIMEOUT_MS = 1_000;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function sendRawRequest(server: StudioViewerServer, request: string): Promise<string> {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = new Socket();
    let settled = false;
    let response = '';
    let timeout: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.off('connect', sendRequest);
      socket.off('data', appendResponse);
      socket.off('end', resolveFromEnd);
      socket.off('close', rejectFromClose);
      socket.off('error', rejectFromError);
      if (!socket.destroyed) {
        socket.destroy();
      }
    };
    const resolveWithResponse = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolveResponse(response);
    };
    const rejectWithError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectResponse(error);
    };
    const sendRequest = (): void => {
      socket.end(request);
    };
    const appendResponse = (chunk: string): void => {
      response += chunk;
    };
    const resolveFromEnd = (): void => {
      if (response.length === 0) {
        rejectWithError(new Error('Raw viewer request ended before a response was received.'));
        return;
      }
      resolveWithResponse();
    };
    const rejectFromClose = (): void => rejectWithError(new Error('Raw viewer request socket closed before response end.'));
    const rejectFromError = (error: Error): void => rejectWithError(error);

    socket.setEncoding('utf8');
    socket.on('connect', sendRequest);
    socket.on('data', appendResponse);
    socket.once('end', resolveFromEnd);
    socket.once('close', rejectFromClose);
    socket.once('error', rejectFromError);
    timeout = setTimeout(() => {
      rejectWithError(new Error(`Raw viewer request timed out within ${String(RAW_REQUEST_TIMEOUT_MS)}ms.`));
    }, RAW_REQUEST_TIMEOUT_MS);
    socket.connect({
      host: server.url.hostname,
      port: Number(server.url.port),
    });
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

  it('rejects a raw request when the peer closes before ending its response', async () => {
    // Given: a local peer that accepts a connection and closes before any HTTP response ends.
    const sockets = new Set<Socket>();
    const closingServer = createServer();
    closingServer.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      closingServer.once('error', reject);
      closingServer.listen(0, '127.0.0.1', () => {
        closingServer.off('error', reject);
        resolve();
      });
    });
    const address = closingServer.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve, reject) => closingServer.close((error) => error ? reject(error) : resolve()));
      throw new Error('Failed to allocate socket-closing test port.');
    }
    const viewer: StudioViewerServer = {
      close: () => new Promise<void>((resolve, reject) => closingServer.close((error) => error ? reject(error) : resolve())),
      url: new URL(`http://127.0.0.1:${String(address.port)}/`),
    };

    try {
      // When: the raw request helper observes the peer close.
      let timeout: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        sendRawRequest(viewer, 'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
          .then(() => 'resolved' as const, () => 'rejected' as const),
        new Promise<'timed-out'>((resolve) => {
          timeout = setTimeout(() => resolve('timed-out'), RAW_REQUEST_TIMEOUT_MS + 500);
        }),
      ]).finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });

      // Then: a close is a bounded transport failure rather than a hanging helper.
      expect(result).toBe('rejected');
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await viewer.close();
    }
  });
});
