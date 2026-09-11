import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { transformFileAsync } from '@babel/core';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
let packageRootPath: string;
let fixtureRootPath: string;
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
let babelConfigPath: string;
let buildTsconfigPath: string;

type SourceArtifacts = {
  readonly declaration: string;
  readonly runtime: string;
  readonly runtimeRootExports: readonly string[];
};

let sourceArtifacts: SourceArtifacts | undefined;

function readRuntimeExports(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const runtime = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }

    if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name) {
      runtime.add(statement.name.text);
    }
  }

  return [...runtime].sort();
}

function normalizeAst(sourceText: string, filePath: string, scriptKind: ts.ScriptKind): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  return ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
    .printFile(sourceFile);
}

async function emitSourceRuntime(): Promise<string> {
  const result = await transformFileAsync(resolve(packageRootPath, 'src/adapter.ts'), {
    babelrc: false,
    configFile: babelConfigPath,
  });

  if (typeof result?.code !== 'string') {
    throw new TypeError('Babel did not emit the Cloudflare Workers adapter runtime.');
  }

  return result.code;
}

function emitSourceDeclarations(): string {
  const config = ts.readConfigFile(buildTsconfigPath, ts.sys.readFile);

  if (config.error) {
    throw new TypeError(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    packageRootPath,
    { declarationMap: false },
    buildTsconfigPath,
  );
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  const adapterDeclarationPath = resolve(packageRootPath, 'dist/adapter.d.ts');
  let adapterDeclaration: string | undefined;
  const emitResult = program.emit(
    undefined,
    (filePath, contents) => {
      if (resolve(filePath) === adapterDeclarationPath) {
        adapterDeclaration = contents;
      }
    },
    undefined,
    true,
  );
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];

  if (diagnostics.length > 0) {
    throw new TypeError(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (filePath) => filePath,
      getCurrentDirectory: () => repoRootPath,
      getNewLine: () => '\n',
    }));
  }

  if (adapterDeclaration === undefined) {
    throw new TypeError('TypeScript did not emit the Cloudflare Workers adapter declaration.');
  }

  return adapterDeclaration;
}

function readExportAllTargets(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  return sourceFile.statements
    .filter(ts.isExportDeclaration)
    .filter((statement) => statement.exportClause === undefined)
    .flatMap((statement) =>
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    )
    .sort();
}

function getSourceArtifacts(): SourceArtifacts {
  if (sourceArtifacts === undefined) {
    throw new TypeError('Published source artifacts were not generated before the verification assertions.');
  }

  return sourceArtifacts;
}

describe('@fluojs/platform-cloudflare-workers published artifacts', () => {
  afterAll(async () => {
    if (fixtureRootPath) await rm(fixtureRootPath, { recursive: true, force: true });
  });

  beforeAll(async () => {
    fixtureRootPath = await realpath(await mkdtemp(join(tmpdir(), 'fluo-worker-public-')));
    packageRootPath = join(fixtureRootPath, 'packages/platform-cloudflare-workers');
    babelConfigPath = join(fixtureRootPath, 'tooling/babel/babel.config.cjs');
    buildTsconfigPath = join(packageRootPath, 'tsconfig.build.json');
    const packages = resolveWorkspaceBuildOrder('@fluojs/platform-cloudflare-workers', repoRootPath);
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', buildClosureScript,
      'packages/vite',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repoRootPath, entry), join(fixtureRootPath, entry), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp', '.omo'].includes(basename(source)),
      });
    }
    await symlink(join(repoRootPath, 'node_modules'), join(fixtureRootPath, 'node_modules'), 'dir');
    await execFileAsync(process.execPath, [join(fixtureRootPath, buildClosureScript), '@fluojs/platform-cloudflare-workers'], {
      cwd: fixtureRootPath,
      env: process.env,
      timeout: 240_000,
      killSignal: 'SIGTERM',
    });

    const runtimeRootPath = resolve(packageRootPath, 'dist/index.js');
    const emittedSourceRuntimePromise = emitSourceRuntime();
    const emittedSourceDeclaration = emitSourceDeclarations();
    const runtimeRoot = await import(pathToFileURL(runtimeRootPath).href);

    sourceArtifacts = {
      declaration: emittedSourceDeclaration,
      runtime: await emittedSourceRuntimePromise,
      runtimeRootExports: Object.keys(runtimeRoot).sort(),
    };
  }, 300_000);

  it('keeps request context, WebSocket, SSE, and shutdown runtime behavior structurally aligned with generated source', () => {
    // Given: the package manifest publishes its root runtime from dist/index.js.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          import: './dist/index.js',
        },
      },
    });

    const sourceRootPath = resolve(packageRootPath, 'src/index.ts');
    const sourceAdapterPath = resolve(packageRootPath, 'src/adapter.ts');
    const runtimeRootPath = resolve(packageRootPath, 'dist/index.js');
    const runtimeAdapterPath = resolve(packageRootPath, 'dist/adapter.js');

    // When: the published runtime is parsed against the source artifact generated at suite setup.
    const generatedSourceArtifacts = getSourceArtifacts();

    // Then: the complete executable AST and manifest-root exports match, including lifecycle internals.
    expect(normalizeAst(
      readFileSync(runtimeAdapterPath, 'utf8'),
      runtimeAdapterPath,
      ts.ScriptKind.JS,
    )).toEqual(normalizeAst(generatedSourceArtifacts.runtime, sourceAdapterPath, ts.ScriptKind.JS));
    expect(readExportAllTargets(runtimeRootPath)).toEqual(readExportAllTargets(sourceRootPath));
    expect(generatedSourceArtifacts.runtimeRootExports).toEqual(readRuntimeExports(sourceAdapterPath));
  });

  it('keeps declaration members and signatures structurally aligned with source', () => {
    // Given: the package manifest publishes its root declarations from dist/index.d.ts.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          types: './dist/index.d.ts',
        },
      },
    });

    const sourceRootPath = resolve(packageRootPath, 'src/index.ts');
    const sourceAdapterPath = resolve(packageRootPath, 'src/adapter.ts');
    const declarationRootPath = resolve(packageRootPath, 'dist/index.d.ts');
    const declarationAdapterPath = resolve(packageRootPath, 'dist/adapter.d.ts');

    // When: the published declaration is parsed against the source artifact generated at suite setup.
    const generatedSourceArtifacts = getSourceArtifacts();

    // Then: every declaration member/signature and the manifest-root export graph match source.
    expect(normalizeAst(
      readFileSync(declarationAdapterPath, 'utf8'),
      declarationAdapterPath,
      ts.ScriptKind.TS,
    )).toEqual(normalizeAst(generatedSourceArtifacts.declaration, sourceAdapterPath, ts.ScriptKind.TS));
    expect(readExportAllTargets(declarationRootPath)).toEqual(readExportAllTargets(sourceRootPath));
  });

  it('publishes the canonical Worker host and adapter classes without retired helpers', () => {
    const generatedSourceArtifacts = getSourceArtifacts();
    const retiredExports = [
      'bootstrapCloudflareWorkerApplication',
      'createCloudflareWorkerAdapter',
      'createCloudflareWorkerEntrypoint',
      'createCloudflareWorkerEnvEntrypoint',
    ] as const;

    expect(generatedSourceArtifacts.runtimeRootExports).toContain('CloudflareWorkerApplicationHost');
    expect(generatedSourceArtifacts.runtimeRootExports).toContain('CloudflareWorkerHttpApplicationAdapter');

    for (const retiredExport of retiredExports) {
      expect(generatedSourceArtifacts.runtimeRootExports).not.toContain(retiredExport);
      expect(generatedSourceArtifacts.runtime).not.toContain(`function ${retiredExport}`);
      expect(generatedSourceArtifacts.declaration).not.toContain(`declare function ${retiredExport}`);
    }
    const declaration = ts.createSourceFile('adapter.d.ts', generatedSourceArtifacts.declaration, ts.ScriptTarget.Latest, true);
    const declaredNames = declaration.statements.flatMap((node) =>
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
       ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name
        ? [node.name.text] : [],
    );
    for (const name of [
      'BootstrapCloudflareWorkerApplicationOptions', 'CloudflareWorkerApplication',
      'CloudflareWorkerEntrypoint', 'CloudflareWorkerEnvBootstrap',
      'CloudflareWorkerEnvEntrypointFactory', 'CloudflareWorkerEnvEntrypoint',
    ]) expect(declaredNames).not.toContain(name);
  });

  it('preserves required environment and concrete adapter types in emitted declarations', () => {
    const consumerPath = resolve(packageRootPath, 'consumer.mts');
    const consumer = `
      import { CloudflareWorkerApplicationHost, CloudflareWorkerHttpApplicationAdapter } from './dist/index.js';
      type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      type Assert<T extends true> = T;
      type Env = { token: string };
      class AppModule {}
      const fixed = CloudflareWorkerApplicationHost.create(AppModule);
      const configured = CloudflareWorkerApplicationHost.create<Env>({ fromEnv: () => ({ rootModule: AppModule }) });
      const adapter = CloudflareWorkerHttpApplicationAdapter.create();
      type FixedReady = Assert<Equal<Parameters<typeof fixed.ready>, []>>;
      type EnvReady = Assert<Equal<Parameters<typeof configured.ready>, [env: Env]>>;
      type ConcreteAdapter = Assert<Equal<typeof adapter, CloudflareWorkerHttpApplicationAdapter>>;
    `;
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      noEmit: true,
      types: ['node'],
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      resolve(fileName) === consumerPath
        ? ts.createSourceFile(fileName, consumer, languageVersion, true)
        : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([consumerPath], options, host);
    expect(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )).toEqual([]);
  });
});
