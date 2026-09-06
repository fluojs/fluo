import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const buildClosureScript = fileURLToPath(new URL('../scripts/run-workspace-build-closure.mjs', import.meta.url));
const fixture = `${root}tooling/governance/decorator-defaults-consumer.ts`;
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
      '@fluojs/core': [`${root}packages/core/dist/index.d.ts`],
      '@fluojs/http': [`${root}packages/http/dist/index.d.ts`],
      '@fluojs/http/portable': [`${root}packages/http/dist/index.portable.d.ts`],
      '@fluojs/openapi': [`${root}packages/openapi/dist/index.d.ts`],
      '@fluojs/react': [`${root}packages/react/dist/index.d.ts`],
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
  beforeAll(async () => {
    for (const packageName of ['@fluojs/react', '@fluojs/openapi']) {
      await execFileAsync(process.execPath, [buildClosureScript, packageName], {
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
