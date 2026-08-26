import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { publishJsonExclusive, searchArtifact } from './publication.mjs';

const valueAfter = (args, flag) => {
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

export const publishSearchArtifact = ({
  repositoryRoot,
  runId,
  issueNumbers,
}) => {
  if (
    typeof runId !== 'string' ||
    !/^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9+._-]*$/u.test(runId)
  ) {
    throw new TypeError('run_id must be a safe artifact basename.');
  }
  if (
    !Array.isArray(issueNumbers) ||
    issueNumbers.length === 0 ||
    issueNumbers.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    new Set(issueNumbers).size !== issueNumbers.length
  ) {
    throw new TypeError('issues must be unique positive integers.');
  }

  const requestedRoot = resolve(repositoryRoot);
  assertDirectoryIsNotSymlink(requestedRoot);
  const canonicalRoot = realpathSync(requestedRoot);
  const omoDirectory = resolve(canonicalRoot, '.omo');
  const searchDirectory = resolve(omoDirectory, 'search-issue');
  const artifactDirectory = resolve(searchDirectory, 'artifacts');
  for (const directory of [
    omoDirectory,
    searchDirectory,
    artifactDirectory,
  ]) {
    assertDirectoryIsNotSymlink(directory);
  }
  mkdirSync(artifactDirectory, { recursive: true });

  const target = resolve(artifactDirectory, `${runId}.json`);
  const targetRelative = relative(canonicalRoot, target);
  if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    throw new TypeError('Artifact target escaped the repository root.');
  }
  const artifact = searchArtifact(runId, issueNumbers);
  assertContract('search-artifact-v2', artifact);
  publishJsonExclusive(target, artifact);
  return {
    artifact_path: `.omo/search-issue/artifacts/${runId}.json`,
    artifact,
  };
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const issueNumbers = valueAfter(args, '--issues')
    .split(',')
    .map((value) => Number(value));
  const published = publishSearchArtifact({
    repositoryRoot: valueAfter(args, '--root'),
    runId: valueAfter(args, '--run-id'),
    issueNumbers,
  });
  process.stdout.write(
    `${JSON.stringify({
      artifact_path: published.artifact_path,
      selected_issues: published.artifact.selected_issues,
    })}\n`,
  );
}
