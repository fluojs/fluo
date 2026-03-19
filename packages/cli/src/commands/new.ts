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
    description: 'Write the new app to a custom target directory.',
    option: '--target-directory <path>',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the new command.',
    option: '--help',
  },
];

function parseArgs(argv: string[]): Partial<BootstrapAnswers> {
  const parsed: Partial<BootstrapAnswers> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--name':
        parsed.projectName = next;
        index += 1;
        break;
      case '--package-manager':
        parsed.packageManager = next as BootstrapAnswers['packageManager'];
        index += 1;
        break;
      case '--target-directory':
        parsed.targetDirectory = next;
        index += 1;
        break;
      default:
        if (!arg.startsWith('-') && !parsed.projectName) {
          parsed.projectName = arg;
          parsed.targetDirectory = `./${arg}`;
        }
        break;
    }
  }

  return parsed;
}

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
  ].join('\n');
}

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
