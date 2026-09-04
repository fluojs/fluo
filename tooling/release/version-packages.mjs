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

const CHANGESETS_VERSION_RETRY_LIMIT = 3;
const CHANGESETS_TRANSIENT_FAILURE_SIGNATURES = [
  'Failed to parse data from GitHub',
  'invalid json response body',
];

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function changesetsFailureIsTransient(output) {
  return CHANGESETS_TRANSIENT_FAILURE_SIGNATURES.some((signature) => output.includes(signature));
}

function changesetsRetryDelayMilliseconds(attempt) {
  return attempt === 1 ? 2_000 : 5_000;
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

export function runChangesetsVersion(dependencies = {}) {
  const {
    attempts = CHANGESETS_VERSION_RETRY_LIMIT,
    sleep = sleepSync,
    spawn = spawnSync,
    writeOutput = (stream, chunk) => stream.write(chunk),
  } = dependencies;

  for (let attempt = 1; ; attempt += 1) {
    const result = spawn('pnpm', ['exec', 'changeset', 'version'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    if (result.stdout) {
      writeOutput(process.stdout, result.stdout);
    }

    if (result.stderr) {
      writeOutput(process.stderr, result.stderr);
    }

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      return;
    }

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    if (attempt >= attempts || !changesetsFailureIsTransient(output)) {
      throw new Error(`Changesets version command failed with exit code ${result.status ?? 'unknown'}.`);
    }

    writeOutput(
      process.stderr,
      `Changesets version command hit a transient GitHub API failure (attempt ${attempt}/${attempts}); retrying.\n`,
    );
    sleep(changesetsRetryDelayMilliseconds(attempt));
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
