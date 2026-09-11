import { execFile } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWorkspaceBuildOrder } from '../scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
let root: string;
let fixture: string;
const imports = [
  "import * as Http from '@fluojs/http';",
  "import * as Portable from '@fluojs/http/portable';",
  "import * as Core from '@fluojs/core';",
  "import * as OpenApi from '@fluojs/openapi';",
  "import * as React from '@fluojs/react';",
].join('\n');

function compile(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    paths: {
      '@fluojs/core': [join(root, 'packages/core/dist/index.d.ts')],
      '@fluojs/http': [join(root, 'packages/http/dist/index.d.ts')],
      '@fluojs/http/portable': [join(root, 'packages/http/dist/index.portable.d.ts')],
      '@fluojs/openapi': [join(root, 'packages/openapi/dist/index.d.ts')],
      '@fluojs/react': [join(root, 'packages/react/dist/index.d.ts')],
    },
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

describe('published decorator default signatures', () => {
  afterAll(async () => {
    if (root) await rm(root, { force: true, recursive: true });
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fluo-decorator-declarations-'));
    // Keep the copied CLI argv path aligned with Node's canonical import.meta URL.
    root = await realpath(root);
    fixture = join(root, 'decorator-defaults-consumer.ts');
    const targets = ['@fluojs/react', '@fluojs/openapi'];
    const packages = new Set(targets.flatMap((name) => resolveWorkspaceBuildOrder(name, repositoryRoot)));
    const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', buildClosureScript,
      'packages/vite',
      ...[...packages].map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repositoryRoot, entry), join(root, entry), {
        recursive: true,
        // Keep pnpm's relative workspace links inside this fixture, not the source checkout.
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp'].includes(basename(source)),
      });
    }
    // Only external dependencies/build tools are shared; package node_modules are copied above.
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    for (const packageName of targets) {
      await execFileAsync(process.execPath, [join(root, buildClosureScript), packageName], {
        cwd: root,
        env: process.env,
      });
    }
  }, 300_000);

  it('accepts every new caller path through public root and portable imports', () => {
    // Given
    const calls = ['Http', 'Portable'].flatMap((entry) => [
      ...['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All', 'Sse', 'Query']
        .flatMap((name) => ['', 'undefined', "''", "'/'"].map((arg) => `${entry}.${name}(${arg});`)),
      `${entry}.Route('purge');`,
      `${entry}.Route('QUERY', undefined);`,
    ]);
    calls.push(...['Core.Module', 'OpenApi.ApiOperation', 'OpenApi.ApiBody']
      .flatMap((name) => ['', 'undefined', '{}'].map((arg) => `${name}(${arg});`)));
    calls.push("React.Path(); React.Path(undefined); React.Path(''); React.Path('/');",
      "React.Path(undefined, { view: 'index' });",
      '@Core.Module() class EmptyModule {}',
      '@Http.Controller("cats") class Cats { @Http.Get() list() {} }',
      '@React.Router() class Pages { @React.Path() index() {} }',
      'class Operations { @OpenApi.ApiOperation() @OpenApi.ApiBody() method() {} }');

    // When
    const diagnostics = compile(`${imports}\n${calls.join('\n')}`);

    // Then
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  it('still rejects required semantic arguments, null defaults, and bare decorator forms', () => {
    // Given: each line must independently produce a caller diagnostic.
    const invalid = [
      ...['Http', 'Portable'].flatMap((entry) =>
        ['Route', 'HttpCode', 'Version', 'Header', 'Redirect', 'RequestDto', 'Convert']
          .map((name) => `${entry}.${name}();`)),
      "Http.Header('x-name');",
      'Core.Scope();',
      ...['ApiTag', 'ApiResponse', 'ApiParam', 'ApiQuery', 'ApiHeader', 'ApiCookie', 'ApiSecurity']
        .map((name) => `OpenApi.${name}();`),
      ...['PageLayout', 'SuspenseFallback', 'PageMetadata'].map((name) => `React.${name}();`),
      ...['Http.Get', 'Portable.Query', 'Core.Module', 'OpenApi.ApiOperation', 'OpenApi.ApiBody', 'React.Path']
        .map((name) => `${name}(null);`),
      '@Core.Module class BareModule {}',
      'class BareHttp { @Http.Get index() {} }',
      'class BareReact { @React.Path index() {} }',
      'class BareOperation { @OpenApi.ApiOperation index() {} }',
    ];
    const firstInvalidLine = imports.split('\n').length;

    // When
    const diagnostics = compile(`${imports}\n${invalid.join('\n')}`);

    // Then: import/dependency errors cannot masquerade as expected caller failures.
    expect(diagnostics.filter((diagnostic) =>
      diagnostic.file?.fileName !== fixture || diagnostic.start === undefined || diagnostic.code === 2307,
    )).toEqual([]);
    const lines = new Set(diagnostics.flatMap((diagnostic) =>
      diagnostic.file && diagnostic.start !== undefined
        ? [diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line]
        : [],
    ));
    expect([...lines].sort((a, b) => a - b)).toEqual(invalid.map((_, index) => firstInvalidLine + index));
  });
});
