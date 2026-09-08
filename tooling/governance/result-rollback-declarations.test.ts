import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWorkspaceBuildOrder } from '../scripts/run-workspace-build-closure.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const targets = ['@fluojs/prisma', '@fluojs/drizzle', '@fluojs/mongoose'] as const;
let coldRoot: string;
const declarationPaths: Record<string, string[]> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithin(parent: string, path: string): boolean {
  const child = relative(parent, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

function canonicalPath(path: string): string {
  return existsSync(path) ? realpathSync.native(path) : resolve(path);
}

function isWarmDeclaration(path: string): boolean {
  const canonical = canonicalPath(path);
  return !isWithin(coldRoot, canonical) && /[/\\]packages[/\\][^/\\]+[/\\]dist(?:[/\\]|$)/.test(canonical);
}

function compilerHost(options: ts.CompilerOptions, sources: ReadonlyMap<string, string> = new Map()): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile;
  const fileExists = host.fileExists;
  const getSourceFile = host.getSourceFile;

  // A missing paths target otherwise falls back through pnpm workspace symlinks to warm dist.
  host.fileExists = (path) => !isWarmDeclaration(path) && (sources.has(path) || fileExists(path));
  host.readFile = (path) => isWarmDeclaration(path) ? undefined : sources.get(path) ?? readFile(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (isWarmDeclaration(path)) return undefined;
    const source = sources.get(path);
    return source === undefined
      ? getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(path, source, languageVersion, true);
  };
  return host;
}

function diagnosticText(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => repositoryRoot,
    getNewLine: () => '\n',
  });
}

function compile(sources: ReadonlyMap<string, string>, paths = declarationPaths) {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    types: ['node'],
    typeRoots: [join(repositoryRoot, 'node_modules/@types')],
    paths,
  };
  const program = ts.createProgram([...sources.keys()], options, compilerHost(options, sources));
  const diagnostics = ts.getPreEmitDiagnostics(program);

  // Consumer checks may never pass by reading workspace source or previous declaration outputs.
  const workspaceFiles = program.getSourceFiles().filter((source) => {
    const path = canonicalPath(source.fileName);
    return !isWithin(coldRoot, path) && /[/\\]packages[/\\][^/\\]+[/\\](?:src|dist)[/\\]/.test(path);
  });
  expect(workspaceFiles.map((source) => source.fileName)).toEqual([]);
  return diagnostics;
}

const consumer = `
import * as Prisma from '@fluojs/prisma';
import * as Drizzle from '@fluojs/drizzle';
import * as Mongoose from '@fluojs/mongoose';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function exact<T extends true>(): void {}
type Outcome = { readonly kind: 'accepted'; readonly id: number }
  | { readonly kind: 'rejected'; readonly reason: string };
declare const outcome: Outcome;
declare const signal: AbortSignal;
type NativeOptions = { readonly isolationLevel?: 'serializable'; readonly timeout?: number };
type NativeHandle = { readonly query: () => Promise<number> };
interface PrismaNative extends NativeHandle {
  $transaction<T>(fn: (client: NativeHandle) => Promise<T>, options?: NativeOptions): Promise<T>;
}
interface DrizzleNative extends NativeHandle {
  transaction<T>(fn: (database: NativeHandle) => Promise<T>, options?: NativeOptions): Promise<T>;
}
declare const prismaNative: PrismaNative;
declare const drizzleNative: DrizzleNative;
declare const mongooseNative: Mongoose.MongooseConnectionLike;
const nativeOptions: NativeOptions = { isolationLevel: 'serializable', timeout: 250 };
const prisma = new Prisma.PrismaService(prismaNative);
const drizzle = new Drizzle.DrizzleDatabase<DrizzleNative, NativeHandle, NativeOptions>(drizzleNative);
const mongoose = new Mongoose.MongooseConnection(mongooseNative);
const prismaProvider: Prisma.PrismaHandleProvider<PrismaNative> = prisma;
const drizzleProvider: Drizzle.DrizzleHandleProvider<DrizzleNative, NativeHandle, NativeOptions> = drizzle;
const mongooseProvider: Mongoose.MongooseHandleProvider = mongoose;
const prismaFacade: Prisma.PrismaServiceFacade<PrismaNative> = Prisma.PrismaService.createFacade(prismaNative);
const drizzleFacade: Drizzle.DrizzleDatabaseFacade<DrizzleNative, NativeHandle, NativeOptions> =
  Drizzle.DrizzleDatabase.createFacade<DrizzleNative, NativeHandle, NativeOptions>(drizzleNative);
`;

const surfaces = [
  { name: 'prisma', namespace: 'Prisma', native: true },
  { name: 'prismaProvider', namespace: 'Prisma', native: true },
  { name: 'prismaFacade', namespace: 'Prisma', native: true },
  { name: 'drizzle', namespace: 'Drizzle', native: true },
  { name: 'drizzleProvider', namespace: 'Drizzle', native: true },
  { name: 'drizzleFacade', namespace: 'Drizzle', native: true },
  { name: 'mongoose', namespace: 'Mongoose', native: false },
  { name: 'mongooseProvider', namespace: 'Mongoose', native: false },
] as const;

describe('COLD public Result rollback declarations', () => {
  afterAll(async () => {
    if (coldRoot) await rm(coldRoot, { recursive: true, force: true });
  });

  beforeAll(async () => {
    coldRoot = await realpath(await mkdtemp(join(tmpdir(), 'fluo-result-rollback-declarations-')));
    expect(await readdir(coldRoot)).toEqual([]);
    // Only installed dependencies are linked; all workspace declarations must be emitted below.
    await symlink(join(repositoryRoot, 'node_modules'), join(coldRoot, 'node_modules'), 'dir');
    const order = [...new Set(targets.flatMap((name) => resolveWorkspaceBuildOrder(name, repositoryRoot)))];
    const builds = [];

    for (const name of order) {
      const packageDirectory = join(repositoryRoot, 'packages', name.slice('@fluojs/'.length));
      const outputDirectory = join(coldRoot, 'packages', name.slice('@fluojs/'.length), 'dist');
      const manifest: unknown = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
      if (!isRecord(manifest) || !isRecord(manifest.exports)) {
        throw new Error(`Expected an export map for ${name}.`);
      }
      for (const [subpath, entry] of Object.entries(manifest.exports)) {
        if (!isRecord(entry) || typeof entry.types !== 'string') continue;
        if (!entry.types.startsWith('./dist/') || !entry.types.endsWith('.d.ts')) {
          throw new Error(`Unsupported declaration target for ${name}${subpath}: ${entry.types}`);
        }
        const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
        declarationPaths[specifier] = [join(outputDirectory, entry.types.slice('./dist/'.length))];
      }
      await mkdir(dirname(outputDirectory), { recursive: true });
      await symlink(join(packageDirectory, 'node_modules'), join(dirname(outputDirectory), 'node_modules'), 'dir');
      builds.push({ name, packageDirectory, outputDirectory });
    }

    // Reuse only the dependency resolver, not the runner's lock, polling, or repository dist writes.
    for (const { name, packageDirectory, outputDirectory } of builds) {
      const config = ts.getParsedCommandLineOfConfigFile(
        join(packageDirectory, 'tsconfig.build.json'),
        {
          outDir: outputDirectory,
          declarationDir: outputDirectory,
          declarationMap: false,
          emitDeclarationOnly: true,
          noEmit: false,
          noEmitOnError: true,
          incremental: false,
          composite: false,
          paths: declarationPaths,
        },
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            throw new Error(diagnosticText([diagnostic]));
          },
        },
      );
      if (!config) throw new Error(`Cannot parse declaration build config for ${name}.`);
      expect(diagnosticText(config.errors)).toBe('');
      const host = compilerHost(config.options);
      const writeFile = host.writeFile;
      host.writeFile = (path, ...args) => {
        if (!isWithin(outputDirectory, resolve(path))) throw new Error(`Declaration output escaped COLD build: ${path}`);
        writeFile(path, ...args);
      };
      const program = ts.createProgram(config.fileNames, config.options, host);
      expect(diagnosticText(ts.getPreEmitDiagnostics(program)), name).toBe('');
      const result = program.emit();
      expect(diagnosticText(result.diagnostics), name).toBe('');
      expect(result.emitSkipped, name).toBe(false);
    }
    for (const [specifier, paths] of Object.entries(declarationPaths)) {
      expect(paths.every((path) => existsSync(path) && isWithin(coldRoot, canonicalPath(path))), specifier).toBe(true);
    }
  }, 300_000);

  it('infers callback results and policies through all public wrappers, providers, facades, and decorators', () => {
    // Given: native options and application-owned result types are independent of Fluo policies.
    const calls = surfaces.flatMap(({ name, namespace, native }) => {
      const policy = `{ requireAfterCommit: true, shouldRollback(value) {
        exact<Equal<typeof value, Outcome>>(); return value.kind === 'rejected';
      } }`;
      return [
        `const ${name}Result = ${name}.transaction(async () => outcome, ${native ? 'nativeOptions, ' : ''}${policy});
         exact<Equal<typeof ${name}Result, Promise<Outcome>>>();`,
        `const ${name}Request = ${name}.requestTransaction(async () => outcome, signal, ${native ? 'nativeOptions, ' : ''}${policy});
         exact<Equal<typeof ${name}Request, Promise<Outcome>>>();`,
        `const ${name}Policy: ${namespace}.TransactionBoundaryOptions<Outcome> =
           { shouldRollback: value => value.kind === 'rejected' };
         ${name}.transaction(async () => outcome, ${native ? 'undefined, ' : ''}${name}Policy);
         ${name}.requestTransaction(async () => outcome, undefined, ${native ? 'undefined, ' : ''}${name}Policy);`,
        `const ${name}Plain = ${name}.transaction(async () => 42);
         const ${name}PlainRequest = ${name}.requestTransaction(async () => 'plain');
         exact<Equal<typeof ${name}Plain, Promise<number>>>();
         exact<Equal<typeof ${name}PlainRequest, Promise<string>>>();
         ${name}.transaction(async () => 'custom', ${native ? 'undefined, ' : ''}
           { shouldRollback(value) { exact<Equal<typeof value, string>>(); return value === 'custom'; } });`,
      ];
    });
    const policies = ['Prisma', 'Drizzle', 'Mongoose'].map((namespace) => `
      const ${namespace}Policy: ${namespace}.TransactionBoundaryOptions<Outcome> =
        { shouldRollback: value => value.kind === 'rejected', requireAfterCommit: true };
      const ${namespace}Empty: ${namespace}.TransactionBoundaryOptions = {};
      const ${namespace}Legacy: ${namespace}.TransactionBoundaryOptions = { requireAfterCommit: true };
      const ${namespace}Unknown: ${namespace}.TransactionBoundaryOptions = {
        shouldRollback(value) { exact<Equal<typeof value, unknown>>(); return value === null; }
      };
      const ${namespace}Only = new ${namespace}.TransactionRollbackOnlyError(outcome);
      exact<Equal<typeof ${namespace}Only.result, unknown>>();
      const ${namespace}Error: Error = ${namespace}Only;
      const ${namespace}Capability: Error = new ${namespace}.TransactionRollbackCapabilityError();
      const ${namespace}Unconfirmed: Error = new ${namespace}.TransactionRollbackUnconfirmedError({ cause: outcome });
      const ${namespace}Observer: ${namespace}.TransactionRollbackObserver = {
        run: callback => callback(),
        beginAttempt: transaction => ({ confirmRollback: () => true }),
      };
      const ${namespace}Observation: ${namespace}.TransactionRollbackObservation = { confirmRollback: async () => true as const };
      exact<Equal<ReturnType<${namespace}.TransactionRollbackObservation['confirmRollback']>, true | Promise<true>>>();
    `);
    const decorators = `
      const factory = { adapterName: '@prisma/adapter-pg', connect: async () => ({}) };
      const observedPrisma = Prisma.createPrismaRollbackObserver(factory);
      exact<Equal<typeof observedPrisma.adapter, typeof factory>>();
      const pg = { query: async (sql: string) => ({ rows: [] }), connect: async () => undefined };
      const observedDrizzle = Drizzle.createDrizzleRollbackObserver(pg);
      exact<Equal<typeof observedDrizzle.client, typeof pg>>();
      const observedMongo = Mongoose.createMongooseRollbackObserver({});
      exact<Equal<typeof observedMongo, Mongoose.TransactionRollbackObserver>>();
      const prismaRegistration: Prisma.PrismaModuleOptions<PrismaNative> = { client: prismaNative, rollbackObserver: PrismaObserver };
      const drizzleRegistration: Drizzle.DrizzleModuleOptions<DrizzleNative, NativeHandle, NativeOptions> = { database: drizzleNative, rollbackObserver: DrizzleObserver };
      const mongooseRegistration: Mongoose.MongooseModuleOptions = { connection: mongooseNative, rollbackObserver: MongooseObserver };
      class PrismaService {
        readonly prisma = prismaFacade;
        @Prisma.Transaction() async noArgs() { return 42; }
        @Prisma.Transaction(nativeOptions) async native() { return 'native'; }
        @Prisma.Transaction((self: PrismaService) => self.prisma) async accessor() { return outcome; }
        @Prisma.Transaction(undefined, PrismaPolicy) async policy(): Promise<Outcome> { return outcome; }
        @Prisma.Transaction(nativeOptions, PrismaPolicy) async nativePolicy(): Promise<Outcome> { return outcome; }
        @Prisma.Transaction((self: PrismaService) => self.prisma, PrismaPolicy)
        async accessorPolicy(): Promise<Outcome> { return outcome; }
      }
      class DrizzleService {
        readonly db = drizzleFacade;
        @Drizzle.Transaction() async noArgs() { return 42; }
        @Drizzle.Transaction(nativeOptions) async native() { return 'native'; }
        @Drizzle.Transaction((self: DrizzleService) => self.db) async accessor() { return outcome; }
        @Drizzle.Transaction((self: DrizzleService) => self.db, nativeOptions) async accessorNative() { return outcome; }
        @Drizzle.Transaction(undefined, undefined, DrizzlePolicy) async policy(): Promise<Outcome> { return outcome; }
        @Drizzle.Transaction(nativeOptions, undefined, DrizzlePolicy) async nativePolicy(): Promise<Outcome> { return outcome; }
        @Drizzle.Transaction((self: DrizzleService) => self.db, nativeOptions, DrizzlePolicy)
        async accessorPolicy(): Promise<Outcome> { return outcome; }
      }
      class MongooseService {
        readonly conn = mongooseProvider;
        @Mongoose.Transaction() async noArgs() { return 42; }
        @Mongoose.Transaction((self: MongooseService) => self.conn) async accessor() { return outcome; }
        @Mongoose.Transaction(undefined, MongoosePolicy) async policy(): Promise<Outcome> { return outcome; }
        @Mongoose.Transaction((self: MongooseService) => self.conn, MongoosePolicy)
        async accessorPolicy(): Promise<Outcome> { return outcome; }
      }
      exact<Equal<ReturnType<PrismaService['accessorPolicy']>, Promise<Outcome>>>();
      exact<Equal<ReturnType<DrizzleService['accessorPolicy']>, Promise<Outcome>>>();
      exact<Equal<ReturnType<MongooseService['accessorPolicy']>, Promise<Outcome>>>();
      exact<Equal<ReturnType<typeof prismaFacade.query>, Promise<number>>>();
      exact<Equal<ReturnType<typeof drizzleFacade.query>, Promise<number>>>();
    `;

    // When
    const diagnostics = compile(new Map([
      [join(coldRoot, 'consumer.ts'), [consumer, ...calls, ...policies, decorators].join('\n')],
    ]));

    // Then
    expect(diagnosticText(diagnostics)).toBe('');
  }, 30_000);

  it('rejects invalid policy types, misplaced native options, and readonly mutations in isolated consumers', () => {
    // Given: each invalid snippet is a separate module, without diagnostic suppressions.
    const invalid: { readonly source: string; readonly codes: readonly number[] }[] = [];
    for (const { name, namespace, native } of surfaces) {
      invalid.push(
        {
          source: `${name}.transaction(async () => outcome, ${native ? 'undefined, ' : ''}{ shouldRollback: (value: string) => value.length === 0 });`,
          codes: [2345, 2322],
        },
        {
          source: `${name}.requestTransaction(async () => outcome, signal, ${native ? 'undefined, ' : ''}{ shouldRollback: () => 'rollback' });`,
          codes: [2322],
        },
      );
      if (native) {
        invalid.push(
          {
            source: `${name}.transaction(async () => outcome, { shouldRollback: () => true });`,
            codes: [2353],
          },
          {
            source: `${name}.requestTransaction(async () => outcome, signal, { shouldRollback: () => true });`,
            codes: [2353],
          },
          {
            source: `${name}.transaction(async () => outcome, undefined, nativeOptions);`,
            codes: [2559],
          },
        );
      } else {
        invalid.push(
          { source: `${name}.transaction(async () => outcome, { readConcern: { level: 'snapshot' } });`, codes: [2353] },
          { source: `${name}.requestTransaction(async () => outcome, signal, { readConcern: { level: 'snapshot' } });`, codes: [2353] },
          { source: `${name}.transaction(async () => outcome, undefined, {});`, codes: [2554] },
          { source: `${name}.requestTransaction(async () => outcome, signal, undefined, {});`, codes: [2554] },
        );
      }
      invalid.push({
        source: `const policy: ${namespace}.TransactionBoundaryOptions<Outcome> = {}; policy.shouldRollback = () => true;`,
        codes: [2540],
      });
    }
    for (const namespace of ['Prisma', 'Drizzle', 'Mongoose']) {
      invalid.push(
        { source: `const observation: ${namespace}.TransactionRollbackObservation = { confirmRollback: () => false };`, codes: [2322] },
        { source: `const observation: ${namespace}.TransactionRollbackObservation = { confirmRollback() {} };`, codes: [2322] },
        {
          source: `const error = new ${namespace}.TransactionRollbackOnlyError(outcome); error.result = outcome;`,
          codes: [2540],
        },
        {
          source: `const error = new ${namespace}.TransactionRollbackOnlyError(outcome); const value: Outcome = error.result;`,
          codes: [2322],
        },
        {
          source: `class Invalid {
            @${namespace}.Transaction(undefined, ${namespace === 'Drizzle' ? 'undefined, ' : ''}{
              shouldRollback: (value: string) => value.length === 0
            })
            async method(): Promise<number> { return 42; }
          }`,
          codes: [1241, 1270],
        },
      );
    }
    invalid.push(
      { source: 'Mongoose.Transaction({ readConcern: { level: "snapshot" } });', codes: [2353] },
      { source: 'Mongoose.Transaction(undefined, { readConcern: { level: "snapshot" } });', codes: [2353] },
      { source: 'Mongoose.Transaction(undefined, undefined, {});', codes: [2554] },
      {
        source: 'Prisma.Transaction<unknown, NativeOptions>({ shouldRollback: () => true });',
        codes: [2353],
      },
      {
        source: 'Drizzle.Transaction<unknown, NativeOptions>(undefined, { shouldRollback: () => true });',
        codes: [2353],
      },
    );
    const prefix = `${consumer}\n`;
    const sources = new Map(invalid.map(({ source }, index) => [
      join(coldRoot, `invalid-${index}.ts`), `${prefix}${source}`,
    ]));

    // When
    const diagnostics = compile(sources);

    // Then: dependency, prelude, or unrelated errors cannot satisfy a negative expectation.
    expect(diagnosticText(diagnostics.filter((diagnostic) =>
      !diagnostic.file || !sources.has(diagnostic.file.fileName)
      || diagnostic.start === undefined || diagnostic.start < prefix.length,
    ))).toBe('');
    for (const [index, { source, codes }] of invalid.entries()) {
      const fileDiagnostics = diagnostics.filter((diagnostic) => diagnostic.file?.fileName === join(coldRoot, `invalid-${index}.ts`));
      expect(fileDiagnostics.length, source).toBeGreaterThan(0);
      expect(diagnosticText(fileDiagnostics.filter((diagnostic) => !codes.includes(diagnostic.code))), source).toBe('');
    }
  }, 30_000);

  it('keeps rollback owner helpers and a framework Result type out of public root exports', () => {
    // Given
    const sources = new Map(targets.flatMap((name) =>
      ['RollbackOwner', 'ResultBoundary', 'evaluateResult', 'observeRollback', 'Result'].map((symbol) => [
        join(coldRoot, `${name.slice('@fluojs/'.length)}-${symbol}.ts`),
        `import type { ${symbol} } from '${name}';`,
      ] as const),
    ));

    // When
    const diagnostics = compile(sources);

    // Then: TS2305 is an absent named export, not a missing package or dependency.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([...sources].map(() => 2305));
    expect(diagnostics.map((diagnostic) => diagnostic.file?.fileName).sort()).toEqual([...sources.keys()].sort());
  }, 30_000);

  it('reports missing COLD roots instead of falling back to warm workspace declarations', () => {
    // Given: the cold outputs exist, but these explicit mappings point to nonexistent targets.
    const missingPaths = { ...declarationPaths };
    for (const name of targets) missingPaths[name] = [join(coldRoot, 'missing', `${name.slice('@fluojs/'.length)}.d.ts`)];
    const fixture = join(coldRoot, 'missing-roots.ts');
    const sources = new Map([[fixture, targets.map((name, index) => `import * as Package${index} from '${name}';`).join('\n')]]);

    // When
    const diagnostics = compile(sources, missingPaths);

    // Then
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2307, 2307, 2307]);
    expect(diagnostics.every((diagnostic) => diagnostic.file?.fileName === fixture)).toBe(true);
  }, 30_000);
});
