import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';

import { typegenUsage } from '../usage.js';

type CliStream = {
  write(message: string): unknown;
};

type ReactTypegenModules = {
  readonly react: object;
  readonly runtime: object;
  readonly typegen: object;
};

type ParsedTypegenArgs = {
  readonly exportName: string;
  readonly modulePath: string;
  readonly outputPath: string;
};

const TYPESCRIPT_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const TYPEGEN_MODULE_IDS = ['@fluojs/react', '@fluojs/react/typegen', '@fluojs/runtime'] as const;

class TypegenCommandError extends Error {
  readonly name = 'TypegenCommandError';
}

/** Runtime options for the React page typegen command. */
export interface TypegenCommandRuntimeOptions {
  /** Current working directory for module and output path resolution. */
  readonly cwd?: string;
  /** Optional build-tooling module loader override for tests and editor integrations. */
  readonly loadReactTypegenModules?: (cwd: string) => Promise<ReactTypegenModules>;
  /** Custom stream for error output. */
  readonly stderr?: CliStream;
  /** Custom stream for standard output. */
  readonly stdout?: CliStream;
}

function parseTypegenArgs(argv: readonly string[]): ParsedTypegenArgs {
  let exportName = 'AppModule';
  let modulePath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--output') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new TypegenCommandError('Expected --output to have a file path value.');
      }
      outputPath = next;
      index += 1;
      continue;
    }

    if (option === '--export') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new TypegenCommandError('Expected --export to have a symbol name value.');
      }
      exportName = next;
      index += 1;
      continue;
    }

    if (option?.startsWith('-')) {
      throw new TypegenCommandError(`Unknown option for typegen command: ${option}`);
    }

    if (option !== undefined) {
      if (modulePath !== undefined) {
        throw new TypegenCommandError(`Unexpected extra positional argument: ${option}`);
      }
      modulePath = option;
    }
  }

  if (modulePath === undefined || outputPath === undefined) {
    throw new TypegenCommandError('Usage: fluo typegen <module-path> --output <path> [--export <name>]');
  }

  return { exportName, modulePath, outputPath };
}

function isModuleNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND';
}

async function importProjectModule(moduleId: string, cwd: string): Promise<object> {
  const resolvers = [createRequire(resolve(cwd, 'package.json')), createRequire(import.meta.url)];
  for (const resolver of resolvers) {
    let modulePath: string;
    try {
      modulePath = resolver.resolve(moduleId);
    } catch (error: unknown) {
      if (!isModuleNotFoundError(error)) {
        throw error;
      }
      continue;
    }
    return import(pathToFileURL(modulePath).href);
  }

  throw new TypegenCommandError(`Unable to resolve ${moduleId} from the inspected project.`);
}

async function loadReactTypegenModules(cwd: string): Promise<ReactTypegenModules> {
  const [react, typegen, runtime] = await Promise.all(TYPEGEN_MODULE_IDS.map((moduleId) => importProjectModule(moduleId, cwd)));
  return { react, runtime, typegen };
}

async function importApplicationModule(modulePath: string): Promise<object> {
  const moduleUrl = pathToFileURL(modulePath).href;
  if (!TYPESCRIPT_MODULE_EXTENSIONS.has(extname(modulePath))) {
    return import(moduleUrl);
  }

  const tsconfigPath = resolve(dirname(modulePath), 'tsconfig.json');
  return existsSync(tsconfigPath)
    ? tsImport(moduleUrl, { parentURL: import.meta.url, tsconfig: tsconfigPath })
    : tsImport(moduleUrl, import.meta.url);
}

function requireFunction(owner: object, name: string): (...args: readonly unknown[]) => unknown {
  const value = Reflect.get(owner, name);
  if (typeof value !== 'function') {
    throw new TypegenCommandError(`Required typegen function ${name} is unavailable.`);
  }
  return value;
}

async function createTypegenSource(parsed: ParsedTypegenArgs, cwd: string, modules: ReactTypegenModules): Promise<string> {
  const importedApplication = await importApplicationModule(resolve(cwd, parsed.modulePath));
  const rootModule = Reflect.get(importedApplication, parsed.exportName);
  if (typeof rootModule !== 'function') {
    throw new TypegenCommandError(`Export "${parsed.exportName}" is not a module class constructor.`);
  }

  const factory = Reflect.get(modules.runtime, 'FluoFactory');
  if (typeof factory !== 'function') {
    throw new TypegenCommandError('Required runtime FluoFactory is unavailable.');
  }
  const create = requireFunction(factory, 'create');
  const application = await Reflect.apply(create, factory, [rootModule]);
  if (typeof application !== 'object' || application === null) {
    throw new TypegenCommandError('Runtime application bootstrap returned an invalid value.');
  }

  const close = requireFunction(application, 'close');
  try {
    const dispatcher = Reflect.get(application, 'dispatcher');
    if (typeof dispatcher !== 'object' || dispatcher === null) {
      throw new TypegenCommandError('Runtime application dispatcher is unavailable.');
    }
    const descriptors = Reflect.apply(requireFunction(dispatcher, 'describeRoutes'), dispatcher, []);
    if (!Array.isArray(descriptors)) {
      throw new TypegenCommandError('Runtime route descriptors are unavailable.');
    }
    const catalog = Reflect.apply(requireFunction(modules.react, 'createReactPageCatalog'), undefined, [descriptors]);
    const source = Reflect.apply(requireFunction(modules.typegen, 'generateReactPageTypes'), undefined, [catalog]);
    if (typeof source !== 'string') {
      throw new TypegenCommandError('React page typegen returned an invalid artifact.');
    }
    return source;
  } finally {
    await Reflect.apply(close, application, []);
  }
}

async function writeTypegenArtifact(outputPath: string, source: string): Promise<'CREATE' | 'UNCHANGED' | 'UPDATE'> {
  if (existsSync(outputPath)) {
    if (await readFile(outputPath, 'utf8') === source) {
      return 'UNCHANGED';
    }
    await writeFile(outputPath, source, 'utf8');
    return 'UPDATE';
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, 'utf8');
  return 'CREATE';
}

/**
 * Generates one application-owned React page type artifact.
 *
 * @param argv Command arguments after `typegen`.
 * @param runtime Runtime overrides for module loading and output streams.
 * @returns Process-style command exit code.
 */
export async function runTypegenCommand(
  argv: readonly string[],
  runtime: TypegenCommandRuntimeOptions = {},
): Promise<number> {
  const cwd = runtime.cwd ?? process.cwd();
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.some((argument) => argument === '--help' || argument === '-h')) {
      stdout.write(`${typegenUsage()}\n`);
      return 0;
    }

    const parsed = parseTypegenArgs(argv);
    const modules = await (runtime.loadReactTypegenModules ?? loadReactTypegenModules)(cwd);
    const source = await createTypegenSource(parsed, cwd, modules);
    const outputPath = resolve(cwd, parsed.outputPath);
    const action = await writeTypegenArtifact(outputPath, source);
    stdout.write(`${action} ${outputPath}\n`);
    return 0;
  } catch (error: unknown) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
