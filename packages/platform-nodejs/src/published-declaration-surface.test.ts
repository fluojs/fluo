import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
let packageRootPath: string;
let fixtureRootPath: string;
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
const manifest: { exports: Record<string, { types: string; import: string }> } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const removedNames = [
  'createNodejsAdapter', 'createNodeHttpAdapter', 'NodejsAdapterOptions', 'NodejsHttpApplicationAdapter',
  'bootstrapNodeApplication', 'bootstrapNodejsApplication', 'runNodeApplication', 'runNodejsApplication',
  'BootstrapNodeApplicationOptions', 'BootstrapNodejsApplicationOptions',
  'RunNodeApplicationOptions', 'RunNodejsApplicationOptions', 'NodeApplicationSignal', 'NodejsApplicationSignal',
];

describe('@fluojs/platform-nodejs published declarations and exports', () => {
  afterAll(async () => {
    if (fixtureRootPath) await rm(fixtureRootPath, { recursive: true, force: true });
  });

  beforeAll(async () => {
    fixtureRootPath = await realpath(await mkdtemp(join(tmpdir(), 'fluo-node-public-surface-')));
    packageRootPath = join(fixtureRootPath, 'packages/platform-nodejs');
    const packages = resolveWorkspaceBuildOrder('@fluojs/platform-nodejs', repoRootPath);
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', buildClosureScript,
      'packages/testing/src/babel-decorators-plugin.ts',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repoRootPath, entry), join(fixtureRootPath, entry), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp', '.omo'].includes(basename(source)),
      });
    }
    await symlink(join(repoRootPath, 'node_modules'), join(fixtureRootPath, 'node_modules'), 'dir');

    await execFileAsync(process.execPath, [join(fixtureRootPath, buildClosureScript), '@fluojs/platform-nodejs'], {
      cwd: fixtureRootPath,
      env: process.env,
      timeout: 240_000,
      killSignal: 'SIGTERM',
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
    const workspaceDeclarations = program.getSourceFiles().filter((file) =>
      file.fileName.includes('/packages/') && file.fileName !== consumerFixturePath,
    );
    expect(workspaceDeclarations.length).toBeGreaterThan(0);
    expect(workspaceDeclarations.every((file) =>
      file.isDeclarationFile && file.fileName.startsWith(join(fixtureRootPath, 'packages/')),
    )).toBe(true);

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
      for (const name of removedNames) {
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
        for (const name of ${JSON.stringify(removedNames)}) {
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
