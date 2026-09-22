import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifact = path.join(root, '.artifacts/docs-site');
const manifest = JSON.parse(await readFile(path.join(artifact, 'docs-site-manifest.json'), 'utf8'));
const run = promisify(execFile);
const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
assert.equal(manifest.sourceCommit, commit, 'Artifact belongs to another commit');
if (process.argv.includes('--require-clean')) assert.equal(manifest.dirty, false, 'Release artifact must come from a clean checkout');
for (const [name, version] of Object.entries(manifest.packageVersions)) {
  const source = JSON.parse(await readFile(path.join(root, 'packages', name.slice('@fluojs/'.length), 'package.json'), 'utf8'));
  assert.equal(version, source.version, `Artifact package version mismatch: ${name}`);
}

const port = process.env.DOCS_SMOKE_PORT ?? '4327';
const server = spawn(process.execPath, [path.join(artifact, manifest.entrypoint)], {
  cwd: artifact,
  env: { ...process.env, PORT: port, HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const closed = once(server, 'close');
let log = '';
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Documentation startup deadline: ${log}`)), 30_000);
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Documentation server exited ${code}: ${log}`));
    });
    const consume = (chunk) => {
      log += chunk;
      if (/\bReady in\b/.test(log)) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', consume);
    server.stderr.on('data', consume);
  });
  const origin = `http://127.0.0.1:${port}`;
  for (const checker of ['check-site.mjs', 'check-english-site.mjs', 'check-search.mjs']) {
    const result = await run(process.execPath, [path.join(root, 'tooling/docs', checker), origin], {
      cwd: root,
      timeout: 120_000,
    });
    process.stdout.write(result.stdout);
  }
  console.log(`DOCS_ARTIFACT_PASS ${manifest.sourceCommit} dirty=${manifest.dirty}`);
} finally {
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 5_000);
  await closed;
  clearTimeout(timer);
}
