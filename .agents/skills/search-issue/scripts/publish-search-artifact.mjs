import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { publishJsonExclusive } from './publication.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

const assertDirectoryIsNotSymlink = (path) => {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new TypeError(`Refusing symbolic-link artifact directory: ${path}.`);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const runId = valueAfter('--run-id');
if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(runId)) {
  throw new TypeError('run_id must be a safe lowercase identifier.');
}

const issueNumbers = valueAfter('--issues')
  .split(',')
  .map((value) => Number(value));
if (
  issueNumbers.length === 0 ||
  issueNumbers.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
  new Set(issueNumbers).size !== issueNumbers.length
) {
  throw new TypeError('issues must be unique positive integers.');
}

const repositoryRoot = realpathSync(valueAfter('--root'));
const omoDirectory = resolve(repositoryRoot, '.omo');
const artifactDirectory = resolve(omoDirectory, 'search-issue');
assertDirectoryIsNotSymlink(omoDirectory);
assertDirectoryIsNotSymlink(artifactDirectory);
mkdirSync(artifactDirectory, { recursive: true });

const target = resolve(artifactDirectory, `${runId}.json`);
const targetRelative = relative(repositoryRoot, target);
if (
  targetRelative.startsWith('..') ||
  isAbsolute(targetRelative)
) {
  throw new TypeError('Artifact target escaped the repository root.');
}

publishJsonExclusive(target, {
  version: 1,
  search_run_id: runId,
  selected_issues: issueNumbers,
});

process.stdout.write(
  `${JSON.stringify({
    artifact_path: `.omo/search-issue/${runId}.json`,
    selected_issues: issueNumbers,
  })}\n`,
);
