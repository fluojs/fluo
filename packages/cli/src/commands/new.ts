import { resolve } from 'node:path';

import { renderAliasList, renderHelpTable } from '../help.js';
import { resolveBootstrapAnswers } from '../new/prompt.js';
import { scaffoldBootstrapApp } from '../new/scaffold.js';
import type { BootstrapAnswers, NewCommandOptions } from '../new/types.js';

type CliStream = {
  write(message: string): unknown;
};

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

/** Runtime dependency overrides for the `konekti new` command. */
export interface NewCommandRuntimeOptions extends NewCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stderr?: CliStream;
  stdout?: CliStream;
}

type NewOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

const NEW_OPTION_HELP: NewOptionHelpEntry[] = [
  {
    aliases: [],
    description: 'Provide the project name without using the positional argument.',
    option: '--name <project-name>',
  },
  {
    aliases: [],
    description: 'Choose which package manager installs the starter dependencies.',
    option: '--package-manager <pnpm|npm|yarn>',
  },
  {
    aliases: [],
    description: 'Write the new app to a custom target directory (always overrides positional name path).',
    option: '--target-directory <path>',
  },
  {
    aliases: [],
    description: 'Overwrite files in a non-empty target directory without prompting.',
    option: '--force',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the new command.',
    option: '--help',
  },
];

const SUPPORTED_PACKAGE_MANAGERS = new Set<BootstrapAnswers['packageManager']>(['npm', 'pnpm', 'yarn']);

function readOptionValue(argv: string[], index: number, option: '--name' | '--package-manager' | '--target-directory'): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Expected ${option} to have a value.`);
  }

  return value;
}

function parseArgs(argv: string[]): Partial<BootstrapAnswers> & { force?: boolean } {
  const parsed: Partial<BootstrapAnswers> & { force?: boolean } = {};
  let hasExplicitTargetDirectory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--name':
        if (parsed.projectName) {
          throw new Error('Duplicate --name option.');
        }

        parsed.projectName = readOptionValue(argv, index, '--name');
        index += 1;
        break;
      case '--package-manager':
        if (parsed.packageManager) {
          throw new Error('Duplicate --package-manager option.');
        }

        parsed.packageManager = readOptionValue(argv, index, '--package-manager') as BootstrapAnswers['packageManager'];
        if (!SUPPORTED_PACKAGE_MANAGERS.has(parsed.packageManager)) {
          throw new Error(
            `Invalid --package-manager value "${parsed.packageManager}". Use one of: pnpm, npm, yarn.`,
          );
        }
        index += 1;
        break;
      case '--target-directory':
        if (hasExplicitTargetDirectory) {
          throw new Error('Duplicate --target-directory option.');
        }

        parsed.targetDirectory = readOptionValue(argv, index, '--target-directory');
        hasExplicitTargetDirectory = true;
        index += 1;
        break;
      case '--force':
        parsed.force = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option for new command: ${arg}`);
        }

        if (parsed.projectName) {
          throw new Error(`Unexpected positional argument: ${arg}`);
        }

        parsed.projectName = arg;
        if (!hasExplicitTargetDirectory) {
          parsed.targetDirectory = `./${arg}`;
        }
        break;
    }
  }

  return parsed;
}

/** Renders CLI help text for `konekti new`. */
export function newUsage(): string {
  return [
    'Usage: konekti new|create [project-name] [options]',
    '',
    'Options',
    renderHelpTable(NEW_OPTION_HELP, [
      {
        header: 'Option',
        render: (entry) => entry.option,
      },
      {
        header: 'Aliases',
        render: (entry) => renderAliasList(entry.aliases),
      },
      {
        header: 'Description',
        render: (entry) => entry.description,
      },
    ]),
    '',
    'Next steps:',
    '  cd <app-name>',
    '  pnpm dev',
    '',
    'Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

/**
 * Executes `konekti new` with parsed arguments and scaffold options.
 */
export async function runNewCommand(argv: string[], runtime: NewCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.some(isHelpFlag)) {
      stdout.write(`${newUsage()}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);

    if (!parsed.projectName) {
      throw new Error(newUsage());
    }

    const answers = resolveBootstrapAnswers(parsed, runtime.cwd ?? process.cwd(), runtime.env ?? process.env);
    const options = {
      ...answers,
      dependencySource: runtime.dependencySource,
      force: parsed.force ?? runtime.force,
      repoRoot: runtime.repoRoot,
      skipInstall: runtime.skipInstall,
      targetDirectory: resolve(runtime.cwd ?? process.cwd(), answers.targetDirectory),
    };

    stdout.write(`Installing dependencies with ${answers.packageManager}...\n`);

    await scaffoldBootstrapApp(options);

    stdout.write('Done.\n');
    stdout.write(
      `Next steps:\n  cd ${answers.targetDirectory}\n  ${answers.packageManager === 'npm' ? 'npm run dev' : `${answers.packageManager} dev`}\n`,
    );
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
