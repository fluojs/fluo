import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizePackageChangelog,
  PackageChangelogContractError,
  packageChangelogContractViolation,
} from './package-changelog.mjs';
import { workspacePackageManifests } from './release-intents.mjs';

export { normalizePackageChangelog } from './package-changelog.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
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
  const pendingWrites = [];

  for (const changelogPath of changelogPaths) {
    if (!pathExists(changelogPath)) {
      continue;
    }

    const changelog = readFile(changelogPath, 'utf8');

    if (changelog === previousChangelogs.get(changelogPath)) {
      continue;
    }

    const normalizedChangelog = normalizePackageChangelog(changelog);
    const contractViolation = packageChangelogContractViolation(normalizedChangelog);

    if (contractViolation) {
      throw new PackageChangelogContractError(`${changelogPath}: ${contractViolation}`);
    }

    if (normalizedChangelog !== changelog) {
      pendingWrites.push({ changelogPath, normalizedChangelog });
    }

    normalizedChangelogPaths.push(changelogPath);
  }

  for (const { changelogPath, normalizedChangelog } of pendingWrites) {
    writeFile(changelogPath, normalizedChangelog, 'utf8');
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
