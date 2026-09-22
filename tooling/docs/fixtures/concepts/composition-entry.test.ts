import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const lesson = readFileSync(resolve(root, 'apps/docs/content/docs/guides/package-composition.mdx'), 'utf8');
const entry = lesson.match(/```ts title="src\/main.ts"\n([\s\S]*?)\n```/)?.[1];
if (!entry) throw new Error('The composition guide must expose its shipped entrypoint.');

function diagnostics(code: string) {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.tools.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const filename = resolve(root, 'tooling/docs/fixtures/package-guides/foundation/composition/documented-main.ts');
  const host = ts.createCompilerHost(parsed.options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => file === filename
    ? ts.createSourceFile(file, code.replace("'./welcome/app'", "'./app'"), ts.ScriptTarget.Latest, true)
    : original(file, ...args);
  return ts.getPreEmitDiagnostics(ts.createProgram([filename], parsed.options, host));
}

it('typechecks the shipped composition entrypoint against public package declarations', () => {
  const issues = diagnostics(entry);
  expect(issues.map((issue) => ts.flattenDiagnosticMessageText(issue.messageText, '\n'))).toEqual([]);
});

it('detects the previously incorrect shutdown registration option', () => {
  const issues = diagnostics(entry.replace('shutdownRegistration:', 'registerShutdownSignals:'));
  expect(issues.some((issue) => issue.code === 2353)).toBe(true);
});
