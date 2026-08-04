import { resolve } from 'node:path';

import { TYPEGEN_EXIT_CODES } from '../typegen-contract.js';
import { typegenUsage } from '../usage.js';
import {
  checkTypegenArtifact,
  type TypegenArtifactCheck,
  writeTypegenArtifact,
} from './typegen-artifact.js';
import { parseTypegenArgs, TypegenCommandError } from './typegen-options.js';
import {
  createTypegenSource,
  inspectReactTypegenArtifact,
  loadReactTypegenModules,
  type ReactTypegenModules,
} from './typegen-source.js';
import { runTypegenWatch } from './typegen-watch.js';

type CliStream = {
  write(message: string): unknown;
};

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

function reportCheckResult(
  check: TypegenArtifactCheck,
  outputPath: string,
  stdout: CliStream,
  stderr: CliStream,
): number {
  switch (check.status) {
    case 'UNCHANGED':
      stdout.write(`UNCHANGED ${outputPath}\n`);
      return TYPEGEN_EXIT_CODES.SUCCESS;
    case 'MISSING':
      stderr.write(`MISSING ${outputPath}: run fluo typegen without --check to create the artifact.\n`);
      return TYPEGEN_EXIT_CODES.MISSING;
    case 'STALE':
      stderr.write(`STALE ${outputPath}: generated React page types differ from the authoritative compiled catalog.\n`);
      return TYPEGEN_EXIT_CODES.STALE;
    case 'MALFORMED':
      stderr.write(`MALFORMED ${outputPath}: the target is not a complete React page typegen artifact.\n`);
      return TYPEGEN_EXIT_CODES.MALFORMED;
    case 'UNSUPPORTED_VERSION':
      stderr.write(`UNSUPPORTED_VERSION ${outputPath}: artifact version ${String(check.version)} is not supported by this CLI.\n`);
      return TYPEGEN_EXIT_CODES.UNSUPPORTED_VERSION;
    default: {
      const unreachable: never = check;
      throw new TypegenCommandError(`Unexpected typegen check result: ${String(unreachable)}`);
    }
  }
}

/**
 * Generates, checks, or watches one application-owned React page type artifact.
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
    const outputPath = resolve(cwd, parsed.outputPath);
    const generateAndWrite = async () => {
      const source = await createTypegenSource(parsed, cwd, modules);
      const action = await writeTypegenArtifact(outputPath, source);
      stdout.write(`${action} ${outputPath}\n`);
    };
    if (parsed.watch) {
      return await runTypegenWatch({
        generate: generateAndWrite,
        modulePath: resolve(cwd, parsed.modulePath),
        onError(error) {
          stderr.write(`ERROR ${outputPath}: ${error instanceof Error ? error.message : String(error)}\n`);
        },
        onReady(watchRoot) {
          stdout.write(`WATCHING ${watchRoot}\n`);
        },
        outputPath,
      });
    }

    const source = await createTypegenSource(parsed, cwd, modules);
    if (parsed.check) {
      const check = await checkTypegenArtifact(
        outputPath,
        source,
        (existingSource) => inspectReactTypegenArtifact(modules, existingSource),
      );
      return reportCheckResult(check, outputPath, stdout, stderr);
    }
    const action = await writeTypegenArtifact(outputPath, source);
    stdout.write(`${action} ${outputPath}\n`);
    return TYPEGEN_EXIT_CODES.SUCCESS;
  } catch (error: unknown) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return TYPEGEN_EXIT_CODES.ERROR;
  }
}
