import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStudioViewerArguments, startStudioViewerServer, type StudioViewerServer } from './viewer-server.js';

const temporaryDirectories: string[] = [];
const servers: StudioViewerServer[] = [];
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

  it('runs the packed npm-installed bin through its symlink for help and invalid ports', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'fluo-studio-viewer-consumer-'));
    temporaryDirectories.push(temporaryDirectory);
    const tarballDirectory = join(temporaryDirectory, 'tarball');
    const consumerDirectory = join(temporaryDirectory, 'consumer');
    mkdirSync(tarballDirectory);
    mkdirSync(consumerDirectory);

    const build = spawnSync('pnpm', ['build'], { cwd: packageDirectory, encoding: 'utf8' });
    expect(build.status, [build.stdout, build.stderr].filter(Boolean).join('\n')).toBe(0);

    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', tarballDirectory], {
      cwd: packageDirectory,
      encoding: 'utf8',
    });
    expect(packed.status, [packed.stdout, packed.stderr].filter(Boolean).join('\n')).toBe(0);
    const packResult = JSON.parse(packed.stdout) as readonly { readonly filename: string }[];
    const tarball = join(tarballDirectory, packResult[0]?.filename ?? '');

    const installed = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], {
      cwd: consumerDirectory,
      encoding: 'utf8',
    });
    expect(installed.status, [installed.stdout, installed.stderr].filter(Boolean).join('\n')).toBe(0);

    const binary = join(consumerDirectory, 'node_modules', '.bin', 'fluo-studio-viewer');
    const help = spawnSync(binary, ['--help'], { encoding: 'utf8' });
    const invalidPort = spawnSync(binary, ['--port', 'not-a-port'], { encoding: 'utf8' });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: fluo-studio-viewer');
    expect(invalidPort.status).toBe(1);
    expect(invalidPort.stderr).toContain('Invalid port');
  }, 30_000);
});
