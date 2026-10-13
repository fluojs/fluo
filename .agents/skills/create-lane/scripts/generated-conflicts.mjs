import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { assertPredictedConflicts, generatedHintDigest, isRepositoryFile } from '../../../workflow-contracts/contracts.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Read the same source/config graph as TypegenCompiler.create, excluding the
 * output and installed dependencies. Generator sources are separate inputs.
 * No tracked artifact is regenerated during planning.
 */
export const generatedConsumerGraph = (root, consumer = 'examples/react-vite-ssr') => {
  const cwd = resolve(root, consumer);
  const manifestPath = resolve(cwd, 'package.json');
  const command = JSON.parse(readFileSync(manifestPath, 'utf8')).scripts.typegen;
  const tokens = command.split(/\s+/u);
  const option = (flag) => {
    const index = tokens.indexOf(flag);
    if (index < 0 || !tokens[index + 1]) throw new TypeError(`Missing generation ${flag}`);
    return tokens[index + 1];
  };
  const surface = relative(root, resolve(cwd, option('--output'))).replaceAll('\\', '/');
  const configuration = new Map();
  const readConfiguration = (path) => {
    const text = ts.sys.readFile(path);
    if (text !== undefined) configuration.set(resolve(path), text);
    return text;
  };
  const configPath = resolve(cwd, option('--tsconfig'));
  const config = ts.readConfigFile(configPath, readConfiguration);
  if (config.error) throw new TypeError(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, { ...ts.sys, readFile: readConfiguration }, dirname(configPath));
  if (parsed.errors.length) throw new TypeError('Invalid generated consumer compiler configuration');
  // The canonical CLI command is `node <cli> typegen <module> ...`.
  const modulePath = tokens[tokens.indexOf('typegen') + 1];
  const program = ts.createProgram({ options: parsed.options,
    rootNames: [...new Set([...parsed.fileNames, resolve(cwd, modulePath)])] });
  const files = new Map([...configuration, ...program.getSourceFiles().map((file) => [resolve(file.fileName), file.text])]);
  files.set(manifestPath, readFileSync(manifestPath, 'utf8'));
  files.set(resolve(root, 'pnpm-lock.yaml'), readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
  for (const directory of ['packages/cli/src/commands', 'packages/react/src']) {
    for (const file of readdirSync(resolve(root, directory))) {
      if (!/^typegen(?:[.-].*)?\.ts$/u.test(file) || file.includes('.test.')) continue;
      const path = resolve(root, directory, file);
      files.set(path, readFileSync(path, 'utf8'));
    }
  }
  const inputs = [...files].map(([path, text]) => ({
    path: relative(root, path).replaceAll('\\', '/'), sha256: sha256(text),
  })).filter((input) => isRepositoryFile(input.path) &&
    !input.path.split('/').includes('node_modules') && input.path !== surface)
    .sort((a, b) => a.path.localeCompare(b.path));
  return { surface, command: `pnpm --filter ${JSON.parse(readFileSync(manifestPath, 'utf8')).name} typegen:check`, inputs };
};

/** Produce a source-bound hint before plan/receipt digests are calculated. */
export const deriveGeneratedConflicts = (observations, graph) => {
  const paths = [...graph.inputs.map((input) => input.path), graph.surface];
  const evidence = observations.map(({ issue, title, body }) => {
    if (!Number.isSafeInteger(issue) || issue < 1 || typeof title !== 'string' || typeof body !== 'string') {
      throw new TypeError('Generated planning requires live issue title/body evidence');
    }
    const text = `${title}\n${body}`;
    const references = [
      ...(text.match(/(?:\.agents|packages|examples|tooling|docs)\/[A-Za-z0-9_./*-]+/gu) ?? []),
      ...(text.match(/\b[A-Za-z0-9_.-]+\.(?:json|yaml|yml)\b/gu) ?? []),
    ];
    return { issue, title, body, paths: paths.filter((path) => references.some((reference) => {
      const prefix = reference.replace(/\/?\*.*$/u, '').replace(/\/$/u, '');
      return path === prefix || path.startsWith(`${prefix}/`);
    })) };
  }).filter((item) => item.paths.length > 0);
  if (evidence.length < 2) return [];
  const hint = { surface: graph.surface, issues: evidence.map((item) => item.issue),
    generated: { command: graph.command, inputs: graph.inputs, issue_evidence: evidence, sha256: '' } };
  hint.generated.sha256 = generatedHintDigest(hint);
  assertPredictedConflicts([hint], observations.map((item) => item.issue));
  return [hint];
};

export const withGeneratedConflicts = (plan, observations, graph) => {
  const generated = deriveGeneratedConflicts(observations, graph);
  const hints = [...(plan.predicted_conflicts ?? []).filter((hint) => hint.surface !== graph.surface), ...generated];
  assertPredictedConflicts(hints, plan.confirmed_issues);
  return { ...plan, predicted_conflicts: hints };
};
