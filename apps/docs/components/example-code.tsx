import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';

type ExampleCodeProps = {
  readonly file: string;
  readonly title: string;
};

/** Trusted, repository-authored MDX input; not an HTTP file-serving endpoint. */
export async function ExampleCode({ file, title }: ExampleCodeProps) {
  const code = await readFile(
    path.resolve(process.cwd(), '../../tooling/docs/fixtures', file),
    'utf8',
  );
  return <ServerCodeBlock code={code} lang="ts" codeblock={{ title }} />;
}
