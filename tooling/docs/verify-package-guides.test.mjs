import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyPackageGuides } from './verify-package-guides.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fluo-package-guides-'));
  const put = async (file, body) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  };
  try {
    await put('packages/sample/package.json', JSON.stringify({ name: '@fluojs/sample', version: '1.0.0' }));
    await put('packages/private/package.json', JSON.stringify({ name: '@fluojs/private', private: true }));
    await put('packages/sample/src/index.ts', 'export const value = 1;\n');
    await put('tooling/docs/fixtures/package-guides/sample/example.test.ts', 'export {};\n');
    await run(root, put);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const page = 'apps/docs/content/docs/packages/sample.mdx';
const evidenceFile = 'tooling/docs/fixtures/package-guides/sample/evidence.json';
const evidence = {
  '@fluojs/sample': {
    page,
    sources: ['packages/sample/src/index.ts'],
    tests: ['tooling/docs/fixtures/package-guides/sample/example.test.ts'],
    compositions: ['sample + runtime'],
    verifiedCommands: ['node --test example.test.ts: exit 0'],
  },
};

test('requires a guide for every public package, excluding private fixtures', async () => {
  await fixture(async (root) => {
    const result = await verifyPackageGuides(root);
    assert.equal(result.packages, 1);
    assert.ok(result.issues.some((issue) => issue.code === 'missing-guide'));
  });
});

test('accepts a guide with existing evidence and reports affected packages', async () => {
  await fixture(async (root, put) => {
    await put(page, '---\ntitle: Sample\npackage: "@fluojs/sample"\n---\n');
    await put(evidenceFile, JSON.stringify(evidence));
    const result = await verifyPackageGuides(root, { changedFiles: ['packages/sample/src/index.ts'] });
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.affected, [{ package: '@fluojs/sample', page, pageChanged: false }]);
  });
});

test('rejects duplicate guides, unknown package IDs and broken evidence paths', async () => {
  await fixture(async (root, put) => {
    await put(page, '---\npackage: "@fluojs/sample"\n---\n');
    await put('apps/docs/content/docs/duplicate.mdx', '---\npackage: "@fluojs/sample"\n---\n');
    await put('apps/docs/content/docs/unknown.mdx', '---\npackage: "@fluojs/missing"\n---\n');
    await put(evidenceFile, JSON.stringify({
      '@fluojs/sample': { ...evidence['@fluojs/sample'], tests: ['missing.test.ts'] },
    }));
    const codes = (await verifyPackageGuides(root)).issues.map((issue) => issue.code);
    assert.ok(codes.includes('duplicate-guide'));
    assert.ok(codes.includes('unknown-package'));
    assert.ok(codes.includes('missing-evidence-path'));
  });
});

test('never counts a page-only entry as execution evidence', async () => {
  await fixture(async (root, put) => {
    await put(page, '---\npackage: "@fluojs/sample"\n---\n');
    await put(evidenceFile, JSON.stringify({ '@fluojs/sample': { page } }));
    const result = await verifyPackageGuides(root);
    assert.ok(result.issues.some((issue) => issue.code === 'incomplete-evidence'));
  });
});
