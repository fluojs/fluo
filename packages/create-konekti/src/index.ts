import {
  createTierNote,
  getCreateKonektiPrompts,
  promptForCreateKonektiAnswers,
  resolveSupportTier,
  runCli,
  scaffoldKonektiApp,
} from '@konekti/cli';

export async function runCreateKonekti(argv = process.argv.slice(2)): Promise<void> {
  const exitCode = await runCli(['new', ...argv]);

  if (exitCode !== 0) {
    throw new Error(`create-konekti failed with exit code ${exitCode}.`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  void runCreateKonekti();
}

export { createTierNote, getCreateKonektiPrompts, promptForCreateKonektiAnswers, resolveSupportTier, scaffoldKonektiApp };
export type * from './types.js';
