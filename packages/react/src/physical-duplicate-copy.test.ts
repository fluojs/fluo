import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = resolve(packageRoot, '../..');
const fixtureRoots: string[] = [];

function createPhysicalPackageRoot(root: string, name: 'core' | 'react'): string {
  const packageDirectory = join(root, 'node_modules', '@fluojs', name);
  const sourceDirectory = join(workspaceRoot, 'packages', name);

  mkdirSync(packageDirectory, { recursive: true });
  cpSync(join(sourceDirectory, 'dist'), join(packageDirectory, 'dist'), { recursive: true });
  cpSync(join(sourceDirectory, 'package.json'), join(packageDirectory, 'package.json'));
  return packageDirectory;
}

function runPhysicalCopyFixture(source: string): void {
  const root = join(tmpdir(), `fluo-physical-duplicate-copy-${crypto.randomUUID()}`);
  const copyARoot = join(root, 'copy-a');
  const copyBRoot = join(root, 'copy-b');
  fixtureRoots.push(root);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(join(packageRoot, 'node_modules', 'react'), join(root, 'node_modules', 'react'), 'dir');
  symlinkSync(join(packageRoot, 'node_modules', 'react-dom'), join(root, 'node_modules', 'react-dom'), 'dir');

  for (const copyRoot of [copyARoot, copyBRoot]) {
    createPhysicalPackageRoot(copyRoot, 'core');
    createPhysicalPackageRoot(copyRoot, 'react');
    mkdirSync(join(copyRoot, 'node_modules'), { recursive: true });
    symlinkSync(join(packageRoot, 'node_modules', 'react'), join(copyRoot, 'node_modules', 'react'), 'dir');
    symlinkSync(join(packageRoot, 'node_modules', 'react-dom'), join(copyRoot, 'node_modules', 'react-dom'), 'dir');
    symlinkSync(join(workspaceRoot, 'packages', 'http'), join(copyRoot, 'node_modules', '@fluojs', 'http'), 'dir');
  }

  const fixturePath = join(root, 'fixture.mjs');
  writeFileSync(fixturePath, source.replaceAll('__FIXTURE_ROOT__', pathToFileURL(`${root}/`).href));
  const result = spawnSync(process.execPath, [fixturePath], { encoding: 'utf8' });

  expect(result.status, result.stderr).toBe(0);
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('physical duplicate package roots', () => {
  it('rejects an incompatible metadata registry before compatible core roots exchange metadata', () => {
    // Given: two copied @fluojs/core package roots and an incompatible registry generation.
    runPhysicalCopyFixture(`
      import assert from 'node:assert/strict';
      const root = '__FIXTURE_ROOT__';
      const copyA = new URL('./copy-a/node_modules/@fluojs/core/dist/metadata/shared.js', root);
      const copyB = new URL('./copy-b/node_modules/@fluojs/core/dist/metadata/shared.js', root);
      globalThis[Symbol.for('fluo.metadata.registry')] = { version: 999 };
      globalThis[Symbol.for('fluo.metadata.registry.v1')] = { version: 1 };

      const metadataA = await import(copyA.href);
      const metadataB = await import(copyB.href);
      const target = {};
      const key = Symbol.for('fluo.test.physical-metadata');
      metadataA.getGlobalMetadataWeakMap(key).set(target, 'written-by-a');

      assert.equal(metadataB.getGlobalMetadataWeakMap(key).get(target), 'written-by-a');
    `);
  });

  it('rejects an incompatible router Context while compatible React roots retain provider and SSR boundaries', () => {
    // Given: two copied @fluojs/react package roots and an incompatible router Context generation.
    runPhysicalCopyFixture(`
      import assert from 'node:assert/strict';
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      const root = '__FIXTURE_ROOT__';
      const clientAUrl = new URL('./copy-a/node_modules/@fluojs/react/dist/client.js', root);
      const clientBUrl = new URL('./copy-b/node_modules/@fluojs/react/dist/client.js', root);
      const diagnosticsAUrl = new URL('./copy-a/node_modules/@fluojs/react/dist/diagnostics.js', root);
      const diagnosticsBUrl = new URL('./copy-b/node_modules/@fluojs/react/dist/diagnostics.js', root);
      globalThis[Symbol.for('fluo.react.client-router-context')] = { version: 999 };
      globalThis[Symbol.for('fluo.react.client-router-context.v1')] = { version: 1 };

      const clientA = await import(clientAUrl.href);
      const clientB = await import(clientBUrl.href);
      const diagnosticsA = await import(diagnosticsAUrl.href);
      const diagnosticsB = await import(diagnosticsBUrl.href);
      const error = new Error('physical-copy');
      const context = { metadata: {} };
      function CopyBPathname() {
        return createElement('output', null, clientB.usePathname());
      }

      const html = renderToStaticMarkup(
        createElement(
          clientA.ReactClientRouterProvider,
          { initialSnapshot: clientA.createReactRouteSnapshot({ url: '/physical' }) },
          createElement(CopyBPathname),
        ),
      );
      diagnosticsA.markReactSsrDiagnostic(context, error, {
        code: 'react-ssr-pre-commit-shell-failure',
        error,
        phase: 'pre-commit-shell',
      });

      assert.equal(html, '<output>/physical</output>');
      assert.deepEqual(diagnosticsB.readReactSsrDiagnosticMarker(context, error), {
        code: 'react-ssr-pre-commit-shell-failure',
        error,
        phase: 'pre-commit-shell',
      });
      assert.equal(diagnosticsB.readReactSsrDiagnosticMarker(context, error), undefined);
    `);
  });
});
