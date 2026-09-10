import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const manifest: { exports: Record<string, { types: string; import: string }> } = JSON.parse(
  readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'),
);

describe('@fluojs/platform-nodejs published declarations and exports', () => {
  beforeAll(async () => {
    if (existsSync(resolve(packageRootPath, 'dist/index.d.ts'))) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/platform-nodejs'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it.each([
    'node-static-assets-consumer.test-fixture.ts',
    'node-adapter-consumer.test-fixture.ts',
  ])('type-checks %s against the manifest-published Node declarations', (fixture) => {
    const consumerFixturePath = resolve(packageRootPath, 'src', fixture);
    const program = ts.createProgram([consumerFixturePath], {
      baseUrl: packageRootPath,
      ignoreDeprecations: '6.0',
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      paths: {
        '@fluojs/platform-nodejs': ['dist/index.d.ts'],
        '@fluojs/platform-nodejs/internal': ['dist/internal.d.ts'],
      },
      strict: true,
      target: ts.ScriptTarget.ESNext,
      types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )).toEqual([]);
  }, 30_000);

  it('removes duplicate names from every manifest-published declaration entrypoint', () => {
    const entrypoints = Object.values(manifest.exports).map(({ types }) => resolve(packageRootPath, types));
    const program = ts.createProgram(entrypoints, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    });
    const checker = program.getTypeChecker();
    for (const path of entrypoints) {
      const source = program.getSourceFile(path);
      const symbol = source && checker.getSymbolAtLocation(source);
      if (!symbol) {
        throw new Error(`Missing published declaration module: ${path}`);
      }
      const names = checker.getExportsOfModule(symbol).map((entry) => entry.name);
      expect(names).toContain('NodeHttpApplicationAdapter');
      expect(names).toContain('NodeHttpAdapterOptions');
      for (const name of ['createNodejsAdapter', 'createNodeHttpAdapter', 'NodejsAdapterOptions', 'NodejsHttpApplicationAdapter']) {
        expect(names).not.toContain(name);
      }
    }
  });

  it('loads built JavaScript entrypoints without duplicate factories or replacement classes', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const root = await import('@fluojs/platform-nodejs');
      const manifest = ${JSON.stringify(manifest)};
      for (const subpath of Object.keys(manifest.exports)) {
        const api = await import('@fluojs/platform-nodejs' + (subpath === '.' ? '' : subpath.slice(1)));
        assert.equal(api.NodeHttpApplicationAdapter, root.NodeHttpApplicationAdapter);
        for (const name of ['createNodejsAdapter', 'createNodeHttpAdapter', 'NodejsAdapterOptions', 'NodejsHttpApplicationAdapter']) {
          assert.equal(name in api, false);
        }
      }
      const adapter = root.NodeHttpApplicationAdapter.create({ port: 0 });
      assert.ok(adapter instanceof root.NodeHttpApplicationAdapter);
      await adapter.close();
      console.log('NODE_ADAPTER_PUBLIC_EXPORTS_OK');
    `], { cwd: packageRootPath });
    expect(stdout.trim()).toBe('NODE_ADAPTER_PUBLIC_EXPORTS_OK');
  });
});
