import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const packager = fileURLToPath(new URL('./package-site.mjs', import.meta.url));
const run = promisify(execFile);

async function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function buildFixture(dirty) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fluo-docs-package-'));
  await run('git', ['init', '-q', root]);
  await write(root, 'packages/websockets/package.json', JSON.stringify({ name: '@fluojs/websockets', version: '2.3.4' }));
  await write(root, 'packages/cli/package.json', JSON.stringify({ name: '@fluojs/cli', version: '0.9.0', private: true }));
  await write(root, 'packages/platform-deno/README.md', '# Deprecated\n');
  await write(root, 'packages/platform-deno/CHANGELOG.md', '# Changelog\n');
  await write(root, 'apps/docs/.next/standalone/apps/docs/server.js', 'export {}\n');
  await write(root, 'apps/docs/.next/static/chunk.css', 'body {}\n');
  await write(root, 'apps/docs/public/favicon.ico', 'ico\n');
  await write(root, '.gitignore', '.artifacts/\n');
  await mkdir(path.join(root, 'tooling/docs'), { recursive: true });
  await copyFile(packager, path.join(root, 'tooling/docs/package-site.mjs'));
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '-qm', 'fixture'], { cwd: root });
  const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  if (dirty) await write(root, 'scratch.txt', 'untracked\n');
  return { root, head };
}

for (const scenario of [{ label: 'clean checkout', dirty: false }, { label: 'untracked scratch file', dirty: true }]) {
  test(`docs packaging maps published manifests, skips README-only retired packages (${scenario.label})`, async () => {
    const { root, head } = await buildFixture(scenario.dirty);
    try {
      const script = path.join(root, 'tooling/docs/package-site.mjs');
      assert.equal(await readFile(script, 'utf8'), await readFile(packager, 'utf8'));
      const packaged = await run(process.execPath, [script]);
      assert.match(packaged.stdout, /DOCS_ARTIFACT_READY /);

      const artifact = path.join(root, '.artifacts/docs-site');
      const manifest = JSON.parse(await readFile(path.join(artifact, 'docs-site-manifest.json'), 'utf8'));
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.sourceCommit, head);
      assert.equal(manifest.dirty, scenario.dirty);
      assert.equal(manifest.nodeVersion, process.version);
      assert.equal(manifest.entrypoint, 'apps/docs/server.js');
      assert.deepEqual(manifest.packageVersions, { '@fluojs/websockets': '2.3.4' });
      await readFile(path.join(artifact, 'apps/docs/server.js'));
      await readFile(path.join(artifact, 'apps/docs/.next/static/chunk.css'));
      await readFile(path.join(artifact, 'apps/docs/public/favicon.ico'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
