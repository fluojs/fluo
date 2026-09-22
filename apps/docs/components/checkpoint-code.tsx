import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';

type CheckpointCodeProps = {
  readonly stage:
    | '01-modules'
    | '02-controllers'
    | '03-providers'
    | '04-validation'
    | '05-serialization'
    | '06-errors';
  readonly file: string;
};

/**
 * Build-time documentation input, not a user-controlled file endpoint.
 * Pages display the same complete source files exercised by checkpoint tests.
 */
export async function CheckpointCode({ stage, file }: CheckpointCodeProps) {
  const code = await readFile(
    path.resolve(process.cwd(), '../../tooling/docs/fixtures/learning-path', stage, file),
    'utf8',
  );

  return <ServerCodeBlock code={code} lang="ts" codeblock={{ title: `src/posts/${file}` }} />;
}
