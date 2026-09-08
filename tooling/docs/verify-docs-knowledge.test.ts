import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyDocsKnowledge } from './verify-docs-knowledge.mjs';

const roots: string[] = [];
const indexPath = 'docs/knowledge-index.json';

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function document() {
  return {
    id: 'bootstrap.node-fastify.run',
    kind: 'recipe',
    owner: { en: 'docs/contracts/start.md', ko: 'docs/contracts/start.ko.md' },
    packages: ['@fluojs/core'],
    sourcePaths: ['packages/core/src/index.ts'],
    testPaths: ['packages/core/src/index.test.ts'],
  };
}

function fixture(documents: readonly unknown[] = [document()]): string {
  const root = mkdtempSync(join(tmpdir(), 'fluo-docs-knowledge-'));
  roots.push(root);
  put(root, indexPath, JSON.stringify({ schemaVersion: 1, documents }));
  put(root, 'packages/core/package.json', JSON.stringify({ name: '@fluojs/core', private: false }));
  for (const path of [
    'docs/contracts/start.md', 'docs/contracts/start.ko.md',
    'docs/contracts/other.md', 'docs/contracts/other.ko.md',
    'packages/core/README.md', 'packages/core/README.ko.md',
    'packages/core/src/index.ts', 'packages/core/src/index.test.ts',
  ]) put(root, path, '');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Docs knowledge verification', () => {
  it('accepts a small index without requiring global package coverage', () => {
    const root = fixture();
    put(root, 'packages/unused/package.json', JSON.stringify({ name: '@fluojs/unused', private: false }));
    const result = verifyDocsKnowledge(root);
    expect(result).toEqual({ documents: 1, issues: [] });
  });

  it('rejects duplicate stable IDs even when each document is otherwise valid', () => {
    const root = fixture([document(), document()]);
    const result = verifyDocsKnowledge(root);
    expect(result.issues).toContainEqual({
      code: 'duplicate-id', path: indexPath, target: 'bootstrap.node-fastify.run',
    });
  });

  it('allows distinct IDs to share one owner pair', () => {
    const root = fixture([document(), { ...document(), id: 'bootstrap.explicit-adapter' }]);
    expect(verifyDocsKnowledge(root)).toEqual({ documents: 2, issues: [] });
  });

  it.each(['contract', 'recipe', 'package', 'reference', 'migration'])('accepts the %s kind', (kind) => {
    const root = fixture([{ ...document(), kind }]);
    expect(verifyDocsKnowledge(root).issues).toEqual([]);
  });

  it('accepts a delegated public package README pair', () => {
    const root = fixture([{
      ...document(), kind: 'package',
      owner: { en: 'packages/core/README.md', ko: 'packages/core/README.ko.md' },
    }]);
    expect(verifyDocsKnowledge(root).issues).toEqual([]);
  });

  it.each(['reference', 'migration'])('allows empty evidence for %s', (kind) => {
    const root = fixture([{ ...document(), kind, packages: [], sourcePaths: [], testPaths: [] }]);
    expect(verifyDocsKnowledge(root).issues).toEqual([]);
  });

  it.each([null, [], {}, { schemaVersion: 2, documents: [] }, { schemaVersion: '1', documents: [] },
    { schemaVersion: 1, documents: {} }, { schemaVersion: 1, documents: [], extra: true },
  ])('rejects a malformed index boundary: %j', (value) => {
    const root = fixture();
    put(root, indexPath, JSON.stringify(value));
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'index-shape', path: indexPath });
  });

  it.each([null, [], {}, { ...document(), kind: 'book' }, { ...document(), packages: '@fluojs/core' },
    { ...document(), packages: [null] }, { ...document(), sourcePaths: null },
    { ...document(), testPaths: [1] }, { ...document(), extra: true },
  ])('rejects a malformed document boundary: %j', (value) => {
    const root = fixture([value]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({
      code: 'document-shape', path: indexPath, target: 'documents[0]',
    });
  });

  it.each(['', 'Upper.case', 'has space', '../escape', '한글', '.start', 'end.', 'two..segments'])(
    'rejects an invalid stable ID: %s', (id) => {
      const root = fixture([{ ...document(), id }]);
      expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'invalid-id', path: indexPath, target: id });
    },
  );

  it.each([null, [], 'docs/contracts/start.md', { en: 'docs/contracts/start.md' },
    { en: 1, ko: true }, { ...document().owner, fr: 'docs/contracts/start.fr.md' },
  ])('rejects malformed owner data: %j', (owner) => {
    const root = fixture([{ ...document(), owner }]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({
      code: 'owner-shape', path: indexPath, target: document().id,
    });
  });

  it.each([
    'book/start.md', 'apps/docs/content/docs/start.md', 'README.md', 'docs/README.md', 'docs/CONTEXT.md',
    'docs/contracts/README.md', 'docs/contracts/CONTEXT.md', 'docs/contracts/start.mdx',
    'packages/core/start.md', 'examples/start.md',
  ])('rejects an existing noncanonical owner: %s', (en) => {
    const ko = en.replace(/\.mdx?$/u, '.ko.md');
    const root = fixture([{ ...document(), owner: { en, ko } }]);
    put(root, en, '');
    put(root, ko, '');
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'owner-path', path: indexPath, target: en });
  });

  it.each([
    { en: 'docs/contracts/start.ko.md', ko: 'docs/contracts/start.md' },
    { en: 'docs/contracts/start.md', ko: 'docs/contracts/start.md' },
    { en: 'docs/contracts/start.md', ko: 'docs/contracts/other.ko.md' },
    { en: 'docs/contracts/start.fr.md', ko: 'docs/contracts/start.fr.ko.md' },
  ])('rejects a wrong locale pair: %j', (owner) => {
    const root = fixture([{ ...document(), owner }]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({
      code: 'owner-locale', path: indexPath, target: document().id,
    });
  });

  it.each(['../outside.md', '/tmp/absolute.md', 'C:\\docs\\start.md', 'docs/../start.md',
    './docs/start.md', 'docs//start.md', 'docs/contracts/start.md#anchor', 'docs/start.md?raw=1', 'docs/\0start.md',
  ])('rejects unsafe owner paths: %j', (en) => {
    const root = fixture([{ ...document(), owner: { en, ko: 'docs/contracts/start.ko.md' } }]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'unsafe-path', path: indexPath, target: en });
  });

  it.each(['docs/contracts/start.md', 'docs/contracts/start.ko.md',
    'packages/core/src/index.ts', 'packages/core/src/index.test.ts',
  ])('rejects a missing referenced file: %s', (path) => {
    const root = fixture();
    rmSync(join(root, path));
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'missing-file', path });
  });

  it.each(['sourcePaths', 'testPaths'])('rejects a directory or traversal in %s', (field) => {
    const root = fixture([{ ...document(), [field]: ['packages/core/src', '../outside.ts'] }]);
    const result = verifyDocsKnowledge(root);
    expect(result.issues).toContainEqual({ code: 'not-file', path: 'packages/core/src' });
    expect(result.issues).toContainEqual({ code: 'unsafe-path', path: indexPath, target: '../outside.ts' });
  });

  it.each(['contract', 'recipe', 'package'])('requires source and test evidence for %s', (kind) => {
    const root = fixture([{ ...document(), kind, sourcePaths: [], testPaths: [] }]);
    const result = verifyDocsKnowledge(root);
    expect(result.issues).toContainEqual({ code: 'empty-evidence', path: indexPath, target: 'documents[0].sourcePaths' });
    expect(result.issues).toContainEqual({ code: 'empty-evidence', path: indexPath, target: 'documents[0].testPaths' });
  });

  it.each(['@fluojs/missing', '@fluojs/../core', 'core', '@other/core', ''])('rejects an unknown public package: %s', (name) => {
    const root = fixture([{ ...document(), packages: [name] }]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'unknown-package', path: indexPath, target: name });
  });

  it.each([{ name: '@fluojs/wrong' }, { name: '@fluojs/core', private: true }])(
    'rejects package manifests that do not declare the referenced public package: %j', (manifest) => {
      const root = fixture();
      put(root, 'packages/core/package.json', JSON.stringify(manifest));
      expect(verifyDocsKnowledge(root).issues).toContainEqual({
        code: 'unknown-package', path: indexPath, target: '@fluojs/core',
      });
    },
  );

  it.each([null, [], {}, { name: '@fluojs/core', private: 'false' }])(
    'rejects malformed package manifests: %j', (manifest) => {
      const root = fixture();
      put(root, 'packages/core/package.json', JSON.stringify(manifest));
      expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'package-shape', path: 'packages/core/package.json' });
    },
  );

  it('requires package README ownership to be explicitly delegated in packages', () => {
    const root = fixture([{
      ...document(), packages: [],
      owner: { en: 'packages/core/README.md', ko: 'packages/core/README.ko.md' },
    }]);
    expect(verifyDocsKnowledge(root).issues).toContainEqual({
      code: 'owner-package', path: indexPath, target: '@fluojs/core',
    });
  });

  it('rejects a Book file disguised as a Docs owner through a symlink', () => {
    const root = fixture();
    put(root, 'book/start.md', '');
    rmSync(join(root, document().owner.en));
    symlinkSync(join(root, 'book/start.md'), join(root, document().owner.en));
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'unsafe-path', path: document().owner.en });
  });

  it.each([indexPath, 'packages/core/package.json'])('reports malformed JSON at %s without throwing', (path) => {
    const root = fixture();
    put(root, path, '{');
    expect(verifyDocsKnowledge(root).issues).toContainEqual({ code: 'invalid-json', path });
  });

  it('reports a missing index without throwing', () => {
    const root = fixture();
    rmSync(join(root, indexPath));
    expect(verifyDocsKnowledge(root)).toEqual({ documents: 0, issues: [{ code: 'missing-file', path: indexPath }] });
  });

  it.each([false, true])('CLI exit status reflects invalid data: %s', async (invalid) => {
    const root = fixture(invalid ? [document(), document()] : [document()]);
    const cli = fileURLToPath(new URL('./verify-docs-knowledge.mjs', import.meta.url));
    const child = spawn(process.execPath, [cli], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 4_000 });
    const stderr: string[] = [];
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
    child.stdout.resume();
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(status).toBe(invalid ? 1 : 0);
    if (invalid) {
      const issues: unknown[] = stderr.join('').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
      expect(issues).toContainEqual({ code: 'duplicate-id', path: indexPath, target: document().id });
    }
  });
});
