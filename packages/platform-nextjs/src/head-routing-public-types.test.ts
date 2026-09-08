import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const fixture = fileURLToPath(new URL('../head-policy-consumer.mts', import.meta.url));
const require = createRequire(import.meta.url);
const nextManifest = require.resolve('next/package.json');
const nextRequire = createRequire(nextManifest);
const imports = `
import { createNextAdapter, type NextAdapterOptions } from '@fluojs/platform-nextjs';
import type { NextAdapterOptions as AppOptions } from '@fluojs/platform-nextjs/app-router';
import type { FrameworkRequest } from '@fluojs/http';
import type { FrameworkRequest as PortableRequest } from '@fluojs/http/portable';
`;

function compile(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    noEmit: true,
    strict: true,
    types: [],
    // Next's bundled Satori directory and sharp 0.35 omit type export entries.
    // Use their shipped declarations, not stubs or skipLibCheck. Fluo imports
    // still resolve exclusively through the actual published export maps.
    paths: {
      'next/dist/compiled/@vercel/og/satori': [
        resolve(dirname(nextManifest), 'dist/compiled/@vercel/og/satori/index.d.ts'),
      ],
      sharp: [resolve(dirname(nextRequire.resolve('sharp')), '../lib/index.d.ts')],
    },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

it('accepts the opt-in through built package root, App Router, and HTTP declarations', () => {
  // Given real public export-map resolution, without source aliases.
  const source = `${imports}
const options = { headRouting: 'explicit-or-get' } satisfies NextAdapterOptions;
const appOptions: AppOptions = options;
const policy: FrameworkRequest['headRouting'] = options.headRouting;
const portable: PortableRequest['headRouting'] = policy;
createNextAdapter(appOptions);
createNextAdapter();
`;
  // When TypeScript consumes the built declarations.
  const diagnostics = compile(source);
  // Then the new and existing caller paths both compile.
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});

it('rejects unsupported policy values at each published entry point', () => {
  // Given independently invalid callers, not suppressed type errors.
  const invalid = [
    "createNextAdapter({ headRouting: 'retry-on-404' });",
    "const app: AppOptions = { headRouting: true };",
    "const http: FrameworkRequest['headRouting'] = 'get';",
    "const portable: PortableRequest['headRouting'] = false;",
  ];
  // When TypeScript checks those caller lines.
  const diagnostics = compile(`${imports}${invalid.join('\n')}`);
  // Then each caller fails, while imports and dependency declarations remain valid.
  expect(diagnostics).toHaveLength(invalid.length);
  expect(diagnostics.every((entry) => entry.file?.fileName === fixture && entry.code === 2322)).toBe(true);
  const lines = diagnostics.map((entry) =>
    entry.file && entry.start !== undefined
      ? entry.file.getLineAndCharacterOfPosition(entry.start).line
      : -1);
  expect(lines).toEqual(invalid.map((_, index) => imports.split('\n').length - 1 + index));
});
