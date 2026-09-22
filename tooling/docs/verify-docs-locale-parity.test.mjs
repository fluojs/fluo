import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const checker = new URL('./verify-docs-locale-parity.mjs', import.meta.url);

test('English website accepts canonical files and rejects translated website files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fluo-docs-locales-'));
  try {
    await mkdir(path.join(root, 'overview'));
    await writeFile(path.join(root, 'overview/controllers.mdx'), '---\ntitle: Controllers\n---\n');
    await writeFile(path.join(root, 'overview/meta.json'), '{"pages":["controllers"]}');
    const english = spawnSync(process.execPath, [checker.pathname, root], { encoding: 'utf8' });
    assert.equal(english.status, 0, english.stdout + english.stderr);

    await writeFile(path.join(root, 'overview/controllers.ko.mdx'), '---\ntitle: Legacy\n---\n');
    const translated = spawnSync(process.execPath, [checker.pathname, root], { encoding: 'utf8' });
    assert.equal(translated.status, 1, translated.stdout + translated.stderr);
    assert.match(translated.stderr, /controllers\.ko\.mdx/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
