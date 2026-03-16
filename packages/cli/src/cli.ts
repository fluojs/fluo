import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGenerateCommand } from './commands/generate.js';
import { newUsage, runNewCommand, type NewCommandRuntimeOptions } from './commands/new.js';
import type { GenerateOptions, GeneratorKind } from './types.js';

type CliStream = {
  write(message: string): unknown;
};

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
      command: 'generate';
      parsed: ParsedCliArgs;
    };

const GENERATOR_KINDS: GeneratorKind[] = ['controller', 'dto', 'module', 'repo', 'service'];
function isGeneratorKind(value: string): value is GeneratorKind {
  return GENERATOR_KINDS.includes(value as GeneratorKind);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function generateUsage(): string {
  return [
    'Usage: konekti g <kind> <name> [--target-directory <path>] [--force]',
    'Aliases: konekti generate <kind> <name>',
  ].join('\n');
}

function usage(): string {
  return [
    newUsage(),
    '',
    generateUsage(),
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
  }

  return resolvedStartDirectory;
}

function parseGenerateArgs(argv: string[]): ParsedCliArgs {
  const [command, rawKind, name, ...optionArgs] = argv;

  if (!(command === 'g' || command === 'generate')) {
    throw new Error(usage());
  }

  if (!rawKind || !isGeneratorKind(rawKind) || !name) {
    throw new Error(usage());
  }

  const parsedOptions: GenerateOptions = {};
  let targetDirectory: string | undefined;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    const next = optionArgs[index + 1];

    if (option === '--target-directory' || option === '-o') {
      if (!next) {
        throw new Error('Expected --target-directory to have a value.');
      }

      targetDirectory = next;
      index += 1;
      continue;
    }

    if (option === '--force' || option === '-f') {
      parsedOptions.force = true;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return {
    kind: rawKind,
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

  return {
    argv,
    command: 'generate',
    parsed: parseGenerateArgs(argv),
  };
}

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

    const parsedCommand = parseCommand(argv);

    if (parsedCommand.command === 'new') {
      return runNewCommand(parsedCommand.argv, runtime);
    }

    const targetDirectory = resolve(cwd, parsedCommand.parsed.targetDirectory ?? resolveDefaultTargetDirectory(cwd));

    const files = runGenerateCommand(parsedCommand.parsed.kind, parsedCommand.parsed.name, targetDirectory, parsedCommand.parsed.options);

    stdout.write(`Generated ${files.length} file(s):\n`);
    for (const file of files) {
      stdout.write(`- ${file}\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli();
}
