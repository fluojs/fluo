import { resolve } from 'node:path';

import { createTierNote, promptForCreateKonektiAnswers } from '../new/prompt';
import { scaffoldKonektiApp } from '../new/scaffold';
import type { CreateKonektiAnswers, NewCommandOptions } from '../new/types';

type CliStream = {
  write(message: string): unknown;
};

export interface NewCommandRuntimeOptions extends NewCommandOptions {
  cwd?: string;
  stderr?: CliStream;
  stdout?: CliStream;
}

function parseArgs(argv: string[]): Partial<CreateKonektiAnswers> {
  const parsed: Partial<CreateKonektiAnswers> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--name':
        parsed.projectName = next;
        index += 1;
        break;
      case '--orm':
        parsed.orm = next as CreateKonektiAnswers['orm'];
        index += 1;
        break;
      case '--database':
        parsed.database = next as CreateKonektiAnswers['database'];
        index += 1;
        break;
      case '--package-manager':
        parsed.packageManager = next as CreateKonektiAnswers['packageManager'];
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
    'Usage: konekti new <project-name> [--orm <Prisma|Drizzle>] [--database <PostgreSQL|MySQL>] [--package-manager <pnpm|npm|yarn>] [--target-directory <path>]',
    'Aliases: konekti create <project-name>',
  ].join('\n');
}

export async function runNewCommand(argv: string[], runtime: NewCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    const answers = await promptForCreateKonektiAnswers(parseArgs(argv));
    const options = {
      ...answers,
      dependencySource: runtime.dependencySource,
      repoRoot: runtime.repoRoot,
      skipInstall: runtime.skipInstall,
      targetDirectory: resolve(runtime.cwd ?? process.cwd(), answers.targetDirectory),
    };

    stdout.write(`${createTierNote(answers.orm, answers.database)}\n`);
    stdout.write(`Installing dependencies with ${answers.packageManager}...\n`);

    await scaffoldKonektiApp(options);

    stdout.write('Done.\n');
    stdout.write(
      `Next steps:\n  cd ${answers.targetDirectory}\n  ${answers.packageManager === 'npm' ? 'npm run dev' : `${answers.packageManager} dev`}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
