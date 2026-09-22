import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = path.join(root, 'apps/docs');
const destination = path.join(root, '.artifacts/docs-site');
const run = promisify(execFile);
const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const dirty = (await run('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() !== '';
const versions = {};
for (const entry of await readdir(path.join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(await readFile(path.join(root, 'packages', entry.name, 'package.json'), 'utf8'));
  if (manifest.name?.startsWith('@fluojs/') && manifest.private !== true) {
    versions[manifest.name] = manifest.version;
  }
}

// Only this command's generated artifact directory is replaced.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(docs, '.next/standalone'), destination, { recursive: true });
await cp(path.join(docs, '.next/static'), path.join(destination, 'apps/docs/.next/static'), { recursive: true });
await cp(path.join(docs, 'public'), path.join(destination, 'apps/docs/public'), { recursive: true });
await writeFile(path.join(destination, 'docs-site-manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  sourceCommit: commit,
  dirty,
  nodeVersion: process.version,
  packageVersions: versions,
  entrypoint: 'apps/docs/server.js',
}, null, 2)}\n`);
console.log(`DOCS_ARTIFACT_READY ${destination} commit=${commit} dirty=${dirty}`);
