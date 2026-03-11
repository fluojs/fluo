import { resolve } from 'node:path';

import { scaffoldKonektiApp } from './bootstrap/scaffold';
import { createTierNote, getCreateKonektiPrompts, promptForCreateKonektiAnswers, resolveSupportTier } from './bootstrap/prompt';
import type { CreateKonektiAnswers, CreateKonektiOptions } from './types';

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
        break;
    }
  }

  return parsed;
}

export async function runCreateKonekti(argv = process.argv.slice(2)): Promise<void> {
  const answers = await promptForCreateKonektiAnswers(parseArgs(argv));
  const options: CreateKonektiOptions = {
    ...answers,
    targetDirectory: resolve(answers.targetDirectory),
  };

  await scaffoldKonektiApp(options);

  process.stdout.write(`${createTierNote(answers.orm, answers.database)}\n`);
  process.stdout.write(`Installing dependencies with ${answers.packageManager}...\n`);
  process.stdout.write('Done.\n');
  process.stdout.write(`Next steps:\n  cd ${answers.targetDirectory}\n  ${answers.packageManager === 'npm' ? 'npm run dev' : `${answers.packageManager} dev`}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  void runCreateKonekti();
}

export { createTierNote, getCreateKonektiPrompts, promptForCreateKonektiAnswers, resolveSupportTier, scaffoldKonektiApp };
export type * from './types';
