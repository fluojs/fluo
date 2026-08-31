import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
});
