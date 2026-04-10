import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGenerateCommand } from './commands/generate.js';
import { inspectUsage, runInspectCommand } from './commands/inspect.js';
import { migrateUsage, runMigrateCommand } from './commands/migrate.js';
import { type NewCommandRuntimeOptions, newUsage, runNewCommand } from './commands/new.js';
import { generatorManifest, resolveGeneratorKind } from './generators/manifest.js';
import { renderAliasList, renderHelpTable } from './help.js';
import type { GenerateOptions, GeneratorKind } from './types.js';

type CliStream = {
  write(message: string): unknown;
};

/**
 * Runtime dependency overrides for embedding the CLI in tests or higher-level tooling.
 */
export interface CliRuntimeOptions {
  cwd?: string;
  stderr?: CliStream;
  stdout?: CliStream;
}

type ParsedCliArgs = {
  kind: GeneratorKind;
  name: string;
  options: GenerateOptions;
  targetDirectory?: string;
};

type ParsedCommand =
  | {
      argv: string[];
      command: 'new';
    }
  | {
      argv: string[];
      command: 'migrate';
    }
  | {
      argv: string[];
      command: 'inspect';
    }
  | {
      argv: string[];
      command: 'generate';
      parsed: ParsedCliArgs;
    };

type GenerateKindHelpEntry = {
  aliases: string[];
  description: string;
  kind: GeneratorKind;
  schematic: string;
  wiring: string;
};

type GenerateOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

type TopLevelCommandHelpEntry = {
  aliases: string[];
  command: string;
  description: string;
};

const GENERATE_KIND_HELP: GenerateKindHelpEntry[] = [
  ...generatorManifest.map((entry) => ({
    aliases: [...entry.aliases],
    description: entry.description,
    kind: entry.kind,
    schematic: entry.schematic,
    wiring: entry.wiringBehavior === 'auto-registered' ? 'auto' : 'manual',
  })),
];

const GENERATE_OPTION_HELP: GenerateOptionHelpEntry[] = [
  { aliases: ['-o'], description: 'Write generated files under a specific source directory.', option: '--target-directory <path>' },
  { aliases: ['-f'], description: 'Overwrite files that already exist.', option: '--force' },
  { aliases: ['-h'], description: 'Show help for the generate command.', option: '--help' },
];

const TOP_LEVEL_COMMAND_HELP: TopLevelCommandHelpEntry[] = [
  { aliases: ['create'], command: 'new', description: 'Scaffold a new fluo application and install dependencies.' },
  { aliases: ['g'], command: 'generate', description: 'Generate a schematic inside an existing fluo application.' },
  { aliases: [], command: 'inspect', description: 'Inspect runtime platform snapshot/diagnostics and emit timing optionally.' },
  { aliases: [], command: 'migrate', description: 'Run NestJS-to-fluo codemods (dry-run by default).' },
  { aliases: [], command: 'help', description: 'Show top-level or command-specific help.' },
];

function normalizeGeneratorKind(value: string | undefined): GeneratorKind | undefined {
  return resolveGeneratorKind(value);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function generateUsage(): string {
  return [
    'Usage: konekti generate|g <kind> <name> [options]',
    '',
    'Schematics',
    renderHelpTable(GENERATE_KIND_HELP, [
      { header: 'Schematic', render: (entry) => entry.schematic },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Wiring', render: (entry) => entry.wiring },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    '  auto   = class is auto-registered in the domain module (created if absent)',
    '  manual = files only; you must wire the generated class into a module yourself',
    '',
    'Options',
    renderHelpTable(GENERATE_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Next steps:',
    '  Run \'pnpm typecheck\' to verify the generated module wiring.',
    '  Run \'pnpm test\' to execute the generated test templates.',
    '',
    'Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/generator-workflow.md',
  ].join('\n');
}

function usage(): string {
  return [
    'Usage: konekti <command> [options]',
    '',
    'Commands',
    renderHelpTable(TOP_LEVEL_COMMAND_HELP, [
      { header: 'Command', render: (entry) => entry.command },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    "Run 'konekti help <command>' for more information on a command.",
    'Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

function resolveDefaultTargetDirectory(startDirectory: string): string {
  const resolvedStartDirectory = resolve(startDirectory);

  if (existsSync(join(resolvedStartDirectory, 'package.json')) && existsSync(join(resolvedStartDirectory, 'src'))) {
    return join(resolvedStartDirectory, 'src');
  }

  if (existsSync(join(resolvedStartDirectory, 'apps'))) {
    const appDirectories = readdirSync(join(resolvedStartDirectory, 'apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(resolvedStartDirectory, 'apps', entry.name))
      .filter((directory) => existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'src')));

    if (appDirectories.length === 1) {
      return join(appDirectories[0], 'src');
    }

    if (appDirectories.length > 1) {
      throw new Error('Multiple app targets were found under apps/. Use --target-directory to choose the app src directory explicitly.');
    }
  }

  return resolvedStartDirectory;
}

function parseGenerateArgs(argv: string[]): ParsedCliArgs {
  const [command, rawKind, name, ...optionArgs] = argv;
  const kind = normalizeGeneratorKind(rawKind);

  if (!(command === 'g' || command === 'generate')) {
    throw new Error(usage());
  }

  if (!kind || !name) {
    throw new Error(generateUsage());
  }

  if (name.startsWith('-')) {
    throw new Error(`Invalid resource name "${name}": names cannot start with "-".`);
  }

  const parsedOptions: GenerateOptions = {};
  let targetDirectory: string | undefined;
  let seenForce = false;
  let seenTargetDirectory = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    const next = optionArgs[index + 1];

    if (option === '--target-directory' || option === '-o') {
      if (seenTargetDirectory) {
        throw new Error('Duplicate --target-directory option.');
      }

      if (!next || next.startsWith('-')) {
        throw new Error('Expected --target-directory to have a path value.');
      }

      targetDirectory = next;
      seenTargetDirectory = true;
      index += 1;
      continue;
    }

    if (option === '--force' || option === '-f') {
      if (seenForce) {
        throw new Error('Duplicate --force option.');
      }

      parsedOptions.force = true;
      seenForce = true;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return {
    kind,
    name,
    options: parsedOptions,
    targetDirectory,
  };
}

function parseCommand(argv: string[]): ParsedCommand {
  const [command] = argv;

  if (command === 'new' || command === 'create') {
    return {
      argv: argv.slice(1),
      command: 'new',
    };
  }

  if (command === 'migrate') {
    return {
      argv: argv.slice(1),
      command: 'migrate',
    };
  }

  if (command === 'inspect') {
    return {
      argv: argv.slice(1),
      command: 'inspect',
    };
  }

  return {
    argv,
    command: 'generate',
    parsed: parseGenerateArgs(argv),
  };
}

/**
 * Runs the top-level CLI command dispatcher and returns a process-style exit code.
 *
 * This programmatic entry point mirrors the published `konekti` binary while allowing callers to swap
 * standard streams or the working directory for tests, sandboxes, and editor integrations.
 *
 * @example
 * ```ts
 * import { runCli } from '@fluojs/cli';
 *
 * const output: string[] = [];
 * const exitCode = await runCli(['generate', 'service', 'Post'], {
 *   cwd: '/workspace/app',
 *   stdout: { write: (chunk) => output.push(String(chunk)) },
 *   stderr: { write: (chunk) => output.push(String(chunk)) },
 * });
 * ```
 *
 * @param argv Argument vector to execute. Defaults to the current process arguments without the node/bin prefix.
 * @param runtime Optional runtime overrides shared by the top-level dispatcher and the `new` command.
 * @returns `0` when the command completes successfully, otherwise `1` after writing the error message to `stderr`.
 */
export async function runCli(
  argv = process.argv.slice(2),
  runtime: CliRuntimeOptions & NewCommandRuntimeOptions = {},
): Promise<number> {
  const cwd = runtime.cwd ? resolve(runtime.cwd) : process.cwd();
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.length === 0) {
      throw new Error(usage());
    }

    if (argv[0] === 'help') {
      const topic = argv[1];

      if (topic === 'new' || topic === 'create') {
        stdout.write(`${newUsage()}\n`);
        return 0;
      }

      if (topic === 'g' || topic === 'generate') {
        stdout.write(`${generateUsage()}\n`);
        return 0;
      }

      if (topic === 'migrate') {
        stdout.write(`${migrateUsage()}\n`);
        return 0;
      }

      if (topic === 'inspect') {
        stdout.write(`${inspectUsage()}\n`);
        return 0;
      }

      stdout.write(`${usage()}\n`);
      return 0;
    }

    if (isHelpFlag(argv[0])) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    if ((argv[0] === 'g' || argv[0] === 'generate') && argv.slice(1).some(isHelpFlag)) {
      stdout.write(`${generateUsage()}\n`);
      return 0;
    }

    if (argv[0] === 'migrate' && argv.slice(1).some(isHelpFlag)) {
      stdout.write(`${migrateUsage()}\n`);
      return 0;
    }

    if (argv[0] === 'inspect' && argv.slice(1).some(isHelpFlag)) {
      stdout.write(`${inspectUsage()}\n`);
      return 0;
    }

    const parsedCommand = parseCommand(argv);

    if (parsedCommand.command === 'new') {
      return runNewCommand(parsedCommand.argv, runtime);
    }

    if (parsedCommand.command === 'migrate') {
      return runMigrateCommand(parsedCommand.argv, runtime);
    }

    if (parsedCommand.command === 'inspect') {
      return runInspectCommand(parsedCommand.argv, runtime);
    }

    const targetDirectory = resolve(cwd, parsedCommand.parsed.targetDirectory ?? resolveDefaultTargetDirectory(cwd));

    const result = runGenerateCommand(parsedCommand.parsed.kind, parsedCommand.parsed.name, targetDirectory, parsedCommand.parsed.options);

    stdout.write(`Generated ${result.generatedFiles.length} file(s):\n`);
    for (const file of result.generatedFiles) {
      stdout.write(`  CREATE ${file}\n`);
    }

    stdout.write('\n');

    if (result.wiringBehavior === 'auto-registered' && result.moduleRegistered) {
      stdout.write(`Wiring: auto-registered in ${result.modulePath ?? 'module'}\n`);
    } else if (result.wiringBehavior === 'files-only') {
      stdout.write('Wiring: files only — manual registration required (see next steps)\n');
    }

    stdout.write(`\nNext steps:\n  ${result.nextStepHint}\n`);

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli(undefined, { userAgent: process.env.npm_config_user_agent });
}
