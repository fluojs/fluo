import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackageManifests } from './release-intents.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const unreleasedHeading = '## [Unreleased]';

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }

  return lines.slice(start, end);
}

export function normalizePackageChangelog(changelog) {
  const lines = changelog.trimEnd().split('\n');
  const titleIndex = lines.findIndex((line) => /^# (?!#)/u.test(line));

  if (titleIndex < 0) {
    throw new Error('Package CHANGELOG.md must start with a level-one package title.');
  }

  const unreleasedIndexes = lines.flatMap((line, index) => (line === unreleasedHeading ? [index] : []));

  if (unreleasedIndexes.length > 1) {
    throw new Error('Package CHANGELOG.md must contain at most one `## [Unreleased]` section.');
  }

  const unreleasedIndex = unreleasedIndexes[0];
  let unreleasedBody = [];
  let remainingLines = lines;

  if (unreleasedIndex !== undefined) {
    const nextSectionOffset = lines.slice(unreleasedIndex + 1).findIndex((line) => line.startsWith('## '));
    const sectionEnd = nextSectionOffset < 0 ? lines.length : unreleasedIndex + 1 + nextSectionOffset;
    unreleasedBody = trimBlankEdges(lines.slice(unreleasedIndex + 1, sectionEnd));
    remainingLines = [...lines.slice(0, unreleasedIndex), ...lines.slice(sectionEnd)];
  }

  const title = remainingLines.slice(0, titleIndex + 1);
  const releaseHistory = trimBlankEdges(remainingLines.slice(titleIndex + 1));

  return [
    ...title,
    '',
    unreleasedHeading,
    ...(unreleasedBody.length > 0 ? ['', ...unreleasedBody] : []),
    ...(releaseHistory.length > 0 ? ['', ...releaseHistory] : []),
    '',
  ].join('\n');
}

function publicPackageChangelogPaths(packageManifests) {
  return packageManifests
    .filter(
      ({ manifest }) =>
        manifest.name.startsWith('@fluojs/') &&
        manifest.private !== true &&
        manifest.publishConfig?.access === 'public',
    )
    .map(({ packageJsonPath }) => join(dirname(packageJsonPath), 'CHANGELOG.md'))
    .sort((left, right) => left.localeCompare(right));
}

function runChangesetsVersion() {
  const result = spawnSync('pnpm', ['exec', 'changeset', 'version'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Changesets version command failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

export function runVersionPackages(dependencies = {}) {
  const {
    existsSync: pathExists = existsSync,
    readFileSync: readFile = readFileSync,
    runChangesetsVersion: runVersion = runChangesetsVersion,
    workspacePackageManifests: listPackageManifests = workspacePackageManifests,
    writeFileSync: writeFile = writeFileSync,
  } = dependencies;
  const changelogPaths = publicPackageChangelogPaths(listPackageManifests());
  const previousChangelogs = new Map(
    changelogPaths.map((changelogPath) => [changelogPath, pathExists(changelogPath) ? readFile(changelogPath, 'utf8') : null]),
  );

  runVersion();

  const normalizedChangelogPaths = [];

  for (const changelogPath of changelogPaths) {
    if (!pathExists(changelogPath)) {
      continue;
    }

    const changelog = readFile(changelogPath, 'utf8');

    if (changelog === previousChangelogs.get(changelogPath)) {
      continue;
    }

    const normalizedChangelog = normalizePackageChangelog(changelog);

    if (normalizedChangelog !== changelog) {
      writeFile(changelogPath, normalizedChangelog, 'utf8');
    }

    normalizedChangelogPaths.push(changelogPath);
  }

  return { normalizedChangelogPaths };
}

export function main() {
  const { normalizedChangelogPaths } = runVersionPackages();
  console.log(`Changesets versioning completed; normalized ${normalizedChangelogPaths.length} changed package changelog(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
