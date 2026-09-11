import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
let fixtureRoot: string;
let packageRoot: string;
let fixture: string;
const execFileAsync = promisify(execFile);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const subpaths: string[] = Object.keys(manifest.exports).map((path) =>
  path === '.' ? '@fluojs/runtime' : `@fluojs/runtime${path.slice(1)}`,
);

function compile(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixture], options, host);
  const packageFiles = program.getSourceFiles().filter((file) =>
    file.fileName.includes('/packages/') && file.fileName !== fixture,
  );
  expect(packageFiles.length).toBeGreaterThan(0);
  expect(packageFiles.every((file) => file.isDeclarationFile)).toBe(true);
  expect(packageFiles.every((file) => file.fileName.startsWith(join(fixtureRoot, 'packages/')))).toBe(true);
  return ts.getPreEmitDiagnostics(program);
}

describe('published canonical HTTP factory surface', () => {
  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  beforeAll(async () => {
    fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'fluo-factory-declarations-')));
    packageRoot = join(fixtureRoot, 'packages/runtime');
    fixture = join(packageRoot, 'factory-consumer.mts');
    const packages = resolveWorkspaceBuildOrder('@fluojs/runtime', repositoryRoot);
    const script = 'tooling/scripts/run-workspace-build-closure.mjs';
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', script,
      'packages/vite',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repositoryRoot, entry), join(fixtureRoot, entry), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp', '.omo'].includes(basename(source)),
      });
    }
    await symlink(join(repositoryRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
    await execFileAsync(process.execPath, [join(fixtureRoot, script), '@fluojs/runtime'], {
      cwd: fixtureRoot,
      env: process.env,
      timeout: 240_000,
      killSignal: 'SIGTERM',
    });
  }, 300_000);

  it('infers public tokens, class instances, logger, middleware and host shutdown options from emitted declarations', () => {
    // Given / When
    const diagnostics = compile(`
import { publicToken } from '@fluojs/core';
import { FluoFactory, type Application, type ApplicationLogger } from '@fluojs/runtime';
import type { HttpApplicationAdapter } from '@fluojs/http/portable';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
class Service { readonly value = 17; }
class AppModule {}
const token = publicToken<{ value: number }>('consumer.value');
declare const logger: ApplicationLogger;
declare const adapter: HttpApplicationAdapter;
const app = await FluoFactory.create(AppModule, {
  adapter, logger, cors: false, securityHeaders: false, globalPrefix: '/api',
  shutdownRegistration(application, selectedLogger, timeout) {
    const sameApp: Application = application;
    const sameLogger: ApplicationLogger = selectedLogger;
    const bound: number | undefined = timeout;
    return () => {};
  },
  forceExitTimeoutMs: 123,
});
const value = await app.get(token);
const service = await app.get(Service);
const explicit = await app.get<{ value: number }>('legacy-token');
type Value = Assert<Equal<typeof value, { value: number }>>;
type ClassValue = Assert<Equal<typeof service, Service>>;
type Explicit = Assert<Equal<typeof explicit, { value: number }>>;
await app.listen();
await app.close();
`);
    // Then
    expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
  });

  it('rejects both removed names on every exported declaration subpath', () => {
    // Given / When
    const diagnostics = compile(subpaths.map((path, index) =>
      `import { bootstrapApplication as bootstrap${index}, fluoFactory as alias${index} } from '${path}';`,
    ).join('\n'));
    // Then
    expect(diagnostics, diagnostics.map((entry) =>
      ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
    ).join('\n')).toHaveLength(subpaths.length * 2);
    expect(diagnostics.every((entry) => entry.code === 2305 || entry.code === 2724)).toBe(true);
  });

  it('exposes neither removed name in deployed JavaScript imports', async () => {
    // Given / When: use Node package resolution, not Vitest workspace aliases.
    const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', `
import assert from 'node:assert/strict';
for (const path of ${JSON.stringify(subpaths)}) {
  const api = await import(path);
  assert.equal('bootstrapApplication' in api, false, path);
  assert.equal('fluoFactory' in api, false, path);
}
const { FluoFactory, defineModule } = await import('@fluojs/runtime');
class App {}
defineModule(App, {});
const app = await FluoFactory.create(App, { logger: { log() {}, debug() {}, warn() {}, error() {} } });
assert.equal(app.state, 'bootstrapped');
await app.close();
assert.equal(app.state, 'closed');
console.log('FACTORY_PUBLIC_SURFACE_OK');
`], { cwd: packageRoot, timeout: 30_000 });
    // Then
    expect(result.stdout.trim()).toBe('FACTORY_PUBLIC_SURFACE_OK');
  });
});
