import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const execFileAsync = promisify(execFile);
let root: string;
let fixture: string;
const require = createRequire(import.meta.url);
const nextManifest = require.resolve('next/package.json');
const nextRequire = createRequire(nextManifest);
const imports = `
import { createNextAdapter, type NextAdapterOptions } from '@fluojs/platform-nextjs';
import type { NextAdapterOptions as AppOptions } from '@fluojs/platform-nextjs/app-router';
import type { FrameworkRequest } from '@fluojs/http';
import type { FrameworkRequest as PortableRequest } from '@fluojs/http/portable';
`;

afterAll(async () => {
  if (root) await rm(root, { force: true, recursive: true });
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fluo-next-head-declarations-'));
  // Canonicalize macOS /var so the copied closure CLI matches its import.meta URL.
  root = await realpath(root);
  fixture = join(root, 'packages/platform-nextjs/head-policy-consumer.mts');
  const packages = resolveWorkspaceBuildOrder('@fluojs/platform-nextjs', repositoryRoot);
  const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
  for (const entry of [
    'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
    'tooling/scripts/clean-dist.mjs', buildClosureScript,
    'packages/testing/src/babel-decorators-plugin.ts',
    ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
  ]) {
    await cp(join(repositoryRoot, entry), join(root, entry), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !['dist', '.vite', '.vite-temp'].includes(basename(source)),
    });
  }
  // Share only installed external tools; copied relative workspace links stay cold.
  await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const name of packages) {
    await expect(access(join(root, 'packages', name.slice('@fluojs/'.length), 'dist')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }
  await execFileAsync(process.execPath, [join(root, buildClosureScript), '@fluojs/platform-nextjs'], {
    cwd: root,
    env: process.env,
  });
}, 300_000);

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
