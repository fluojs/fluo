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
import { NextHttpApplicationAdapter, type NextAdapterOptions } from '@fluojs/platform-nextjs';
import { createNextAppRouterHandler, type NextAppRouteHandler, type NextAppRouterMethodHandlers } from '@fluojs/platform-nextjs/app-router';
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

it('accepts root adapter options through built App Router and HTTP declarations', () => {
  // Given real public export-map resolution, without source aliases.
  const source = `${imports}
const options = { headRouting: 'explicit-or-get' } satisfies NextAdapterOptions;
const policy: FrameworkRequest['headRouting'] = options.headRouting;
const portable: PortableRequest['headRouting'] = policy;
const adapter = NextHttpApplicationAdapter.create(options);
const handlers: NextAppRouterMethodHandlers = createNextAppRouterHandler(async () => adapter);
const head: NextAppRouteHandler = handlers.HEAD;
NextHttpApplicationAdapter.create();
`;
  // When TypeScript consumes the built declarations.
  const diagnostics = compile(source);
  // Then the new and existing caller paths both compile.
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});

it('rejects unsupported policy values at each published entry point', () => {
  // Given independently invalid callers, not suppressed type errors.
  const invalid = [
    "NextHttpApplicationAdapter.create({ headRouting: 'retry-on-404' });",
    "const app: NextAdapterOptions = { headRouting: true };",
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


it('exports bounded parser contracts through cold HTTP, Web, and Next declarations', () => {
  const diagnostics = compile(`${imports}
import type { BodyParser, BodyParserContext } from '@fluojs/http';
import type { BodyParser as PortableParser } from '@fluojs/http/portable';
import {
  createWebFrameworkRequest, createWebRequestResponseFactory, dispatchWebRequest,
  type CreateWebRequestResponseFactoryOptions, type DispatchWebRequestOptions,
} from '@fluojs/runtime/web';
const parser: BodyParser = async (text, context: BodyParserContext) => ({
  text, path: context.path, method: context.method,
  mime: context.contentType, headers: context.headers, signal: context.signal,
});
const portable: PortableParser = parser;
const next: NextAdapterOptions = { bodyParser: portable, headRouting: 'explicit-or-get' };
const app: NextAdapterOptions = { bodyParser: 'text' };
const factory: CreateWebRequestResponseFactoryOptions = { bodyParser: 'default' };
const dispatch: DispatchWebRequestOptions = { bodyParser: parser, request: new Request('https://test/') };
NextHttpApplicationAdapter.create(next);
NextHttpApplicationAdapter.create(app);
createWebRequestResponseFactory(factory);
dispatchWebRequest(dispatch);
createWebFrameworkRequest(dispatch.request, dispatch.request.signal, undefined, 100, true, parser);
`);
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});

it('rejects invalid parser modes and callback signatures without type suppression', () => {
  const diagnostics = compile(`${imports}
import type { BodyParser } from '@fluojs/http';
import type { BodyParser as PortableParser } from '@fluojs/http/portable';
import { createWebRequestResponseFactory } from '@fluojs/runtime/web';
NextHttpApplicationAdapter.create({ bodyParser: false });
const app: NextAdapterOptions = { bodyParser: 'json-or-null' };
const parser: BodyParser = (text: number) => text;
const portable: PortableParser = true;
createWebRequestResponseFactory({ bodyParser: 'unlimited' });
`);
  expect(diagnostics).toHaveLength(5);
  expect(diagnostics.every((entry) => entry.file?.fileName === fixture && entry.code === 2322)).toBe(true);
});

it('compiles canonical public imports and constructor subclasses without source aliases', () => {
  const diagnostics = compile(`${imports}
import { defineNextApplication, type NextAdapterLoader } from '@fluojs/platform-nextjs';
import { createNextPagesRouterHandler, type NextPagesRouterConfig } from '@fluojs/platform-nextjs/pages-router';
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';
class CustomAdapter extends NextHttpApplicationAdapter {}
const adapter: NextHttpApplicationAdapter = new CustomAdapter({ maxBodySize: 0 });
const load: NextAdapterLoader = async () => adapter;
const get = defineNextApplication({ key: 'declarations/app', load });
const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createNextAppRouterHandler(get);
const pages = createNextPagesRouterHandler(get);
const config = { api: { bodyParser: false } } satisfies NextPagesRouterConfig;
withFluoNextBackend({});
adapter.fetch(new Request('https://next.test/'));
adapter.close();
`);
  expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
});

it('rejects removed exports and adapter method aliases at every public entry point', () => {
  const removed = {
    '': ['createNextAdapter', 'createNextAppRouterHandler', 'createNextPagesRouterHandler',
      'NextAppRouteHandler', 'NextAppRouterMethodHandlers', 'NextPagesRouterConfig'],
    '/app-router': ['createNextAdapter', 'NextHttpApplicationAdapter', 'InvalidNextAdapterOptionError',
      'NextAdapterOptions', 'NextAdapterLoader', 'defineNextApplication', 'createNextPagesRouterHandler'],
    '/pages-router': ['createNextAdapter', 'NextHttpApplicationAdapter', 'NextAdapterOptions',
      'NextAdapterLoader', 'defineNextApplication', 'createNextAppRouterHandler'],
    '/next-config': ['createNextAdapter', 'NextHttpApplicationAdapter', 'defineNextApplication'],
  };
  const invalid = Object.entries(removed).flatMap(([subpath, names]) =>
    names.map((name, index) =>
      `import { ${name} as removed${subpath.replaceAll(/\W/g, '')}${index} } from '@fluojs/platform-nextjs${subpath}';`));
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    .map((method) => `NextHttpApplicationAdapter.create().${method};`);
  const diagnostics = compile(`${imports}${[...invalid, ...methods].join('\n')}`);
  expect(diagnostics).toHaveLength(invalid.length + methods.length);
  expect(diagnostics.filter((entry) =>
    entry.file?.fileName !== fixture || ![2305, 2724, 2339, 2459].includes(entry.code))
    .map((entry) => ({
      code: entry.code,
      message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
    }))).toEqual([]);
  const lines = diagnostics.map((entry) =>
    entry.file && entry.start !== undefined
      ? entry.file.getLineAndCharacterOfPosition(entry.start).line
      : -1);
  expect(lines).toEqual([...invalid, ...methods].map((_, index) => imports.split('\n').length - 1 + index));
});

it('exposes only canonical runtime names from emitted public entry points', async () => {
  const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
    const surface = {};
    for (const path of ['', '/app-router', '/pages-router', '/next-config']) {
      const entry = await import('@fluojs/platform-nextjs' + path);
      surface[path] = Object.keys(entry).sort();
    }
    console.log(JSON.stringify(surface));
  `], { cwd: join(root, 'packages/platform-nextjs') });
  expect(JSON.parse(result.stdout)).toEqual({
    '': ['InvalidNextAdapterOptionError', 'NextHttpApplicationAdapter', 'defineNextApplication'],
    '/app-router': ['createNextAppRouterHandler'],
    '/pages-router': ['createNextPagesRouterHandler'],
    '/next-config': ['withFluoNextBackend'],
  });
});
