import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const defaultChangesetDirectory = join(repoRoot, '.changeset');
const allowedBumpsByLane = {
  prerelease: new Set(['patch', 'minor', 'major']),
  stable: new Set(['patch', 'minor', 'major']),
};
const validBumps = new Set(['patch', 'minor', 'major']);

function parseCliOptions(argv = process.argv.slice(2)) {
  let baseRef;
  let changesetDirectory = defaultChangesetDirectory;
  let lane = 'stable';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      continue;
    }

    if (argument === '--changeset-dir') {
      changesetDirectory = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument === '--base-ref') {
      baseRef = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--base-ref=')) {
      baseRef = argument.slice('--base-ref='.length);
      continue;
    }

    if (argument.startsWith('--changeset-dir=')) {
      changesetDirectory = resolve(argument.slice('--changeset-dir='.length));
      continue;
    }

    if (argument === '--lane') {
      lane = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--lane=')) {
      lane = argument.slice('--lane='.length);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return { baseRef, changesetDirectory, lane };
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(
      `Changeset release lane check failed: git ${args.join(' ')} exited with ${String(result.status ?? 1)}. ${(result.stderr ?? '').trim()}`,
    );
  }

  return result.stdout;
}

function changesetFilesInDirectory(changesetDirectory, dependencies = {}) {
  const { existsSync: pathExists = existsSync, readdirSync: readDirectory = readdirSync } = dependencies;

  if (!pathExists(changesetDirectory)) {
    return [];
  }

  return readDirectory(changesetDirectory)
    .filter((entry) => entry.endsWith('.md') && entry !== 'README.md')
    .sort()
    .map((entry) => join(changesetDirectory, entry));
}

function frontmatterBlock(contents, filePath) {
  const normalized = contents.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);

  if (!match) {
    throw new Error(`Changeset release lane check failed: ${filePath} is missing YAML frontmatter.`);
  }

  return match[1];
}

function parseChangesetReleaseIntents(contents, filePath) {
  const block = frontmatterBlock(contents, filePath);
  const intents = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const match = /^['"]?([^'"]+)['"]?\s*:\s*['"]?(patch|minor|major)['"]?\s*(?:#.*)?$/.exec(line);

    if (!match) {
      throw new Error(`Changeset release lane check failed: ${filePath} has unsupported frontmatter line: ${rawLine}`);
    }

    intents.push({ bump: match[2], packageName: match[1].trim() });
  }

  if (intents.length === 0) {
    throw new Error(`Changeset release lane check failed: ${filePath} does not declare any package bump intent.`);
  }

  return intents;
}

function collectChangesetReleaseIntents(changesetDirectory, dependencies = {}) {
  const { readFileSync: readFile = readFileSync } = dependencies;

  return changesetFilesInDirectory(changesetDirectory, dependencies).flatMap((filePath) =>
    parseChangesetReleaseIntents(readFile(filePath, 'utf8'), filePath).map((intent) => ({ ...intent, filePath })),
  );
}

function isAllZeroGitSha(value) {
  return /^0{40}$/.test(value);
}

function parsePackageManifestVersion(contents, source) {
  const manifest = JSON.parse(contents);

  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`Changeset release lane check failed: ${source} must declare string name and version fields.`);
  }

  return { packageName: manifest.name, version: manifest.version };
}

function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function semverDelta(previousVersion, nextVersion) {
  const previous = parseStableVersion(previousVersion);
  const next = parseStableVersion(nextVersion);

  if (!previous || !next) {
    return null;
  }

  if (next.major > previous.major) {
    return 'major';
  }

  if (next.major === previous.major && next.minor > previous.minor) {
    return 'minor';
  }

  if (next.major === previous.major && next.minor === previous.minor && next.patch > previous.patch) {
    return 'patch';
  }

  return null;
}

function collectPackageVersionDeltas(baseRef, dependencies = {}) {
  if (typeof baseRef !== 'string' || baseRef.length === 0 || isAllZeroGitSha(baseRef)) {
    return [];
  }

  const { readFileSync: readFile = readFileSync, runGit: git = runGit } = dependencies;
  const diffOutput = git(['diff', '--name-only', baseRef, '--', 'packages/*/package.json']);
  const packageJsonPaths = diffOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();

  return packageJsonPaths.flatMap((packageJsonPath) => {
    const previousContents = git(['show', `${baseRef}:${packageJsonPath}`]);
    const previous = parsePackageManifestVersion(previousContents, `${baseRef}:${packageJsonPath}`);
    const next = parsePackageManifestVersion(readFile(join(repoRoot, packageJsonPath), 'utf8'), packageJsonPath);
    const bump = semverDelta(previous.version, next.version);

    return bump
      ? [
          {
            bump,
            filePath: packageJsonPath,
            nextVersion: next.version,
            packageName: next.packageName,
            previousVersion: previous.version,
          },
        ]
      : [];
  });
}

function packageChangelogPathForPackageJson(packageJsonPath) {
  return join(dirname(packageJsonPath), 'CHANGELOG.md');
}

function changelogSectionForVersion(changelog, version) {
  const heading = `## ${version}`;
  const headingIndex = changelog.indexOf(heading);

  if (headingIndex === -1) {
    return null;
  }

  const nextHeadingIndex = changelog.indexOf('\n## ', headingIndex + heading.length);

  return nextHeadingIndex === -1 ? changelog.slice(headingIndex) : changelog.slice(headingIndex, nextHeadingIndex);
}

function collectDependencyOnlyMajorVersionDeltas(versionDeltas, dependencies = {}) {
  const { existsSync: pathExists = existsSync, readFileSync: readFile = readFileSync } = dependencies;

  return versionDeltas.flatMap((delta) => {
    if (delta.bump !== 'major') {
      return [];
    }

    const changelogPath = packageChangelogPathForPackageJson(delta.filePath);

    if (!pathExists(join(repoRoot, changelogPath))) {
      return [
        {
          ...delta,
          changelogPath,
          reason: `missing ${changelogPath}`,
        },
      ];
    }

    const section = changelogSectionForVersion(readFile(join(repoRoot, changelogPath), 'utf8'), delta.nextVersion);

    if (!section) {
      return [
        {
          ...delta,
          changelogPath,
          reason: `missing changelog section for ${delta.nextVersion}`,
        },
      ];
    }

    return section.includes('### Major Changes')
      ? []
      : [
          {
            ...delta,
            changelogPath,
            reason: 'major version delta only has dependency/patch changelog entries',
          },
        ];
  });
}

export function verifyChangesetReleaseLane(options = {}, dependencies = {}) {
  const baseRef = options.baseRef;
  const changesetDirectory = options.changesetDirectory ?? defaultChangesetDirectory;
  const lane = options.lane ?? 'stable';
  const allowedBumps = allowedBumpsByLane[lane];

  if (!allowedBumps) {
    throw new Error(`Changeset release lane check failed: unknown lane "${lane}". Use "stable" or "prerelease".`);
  }

  const intents = collectChangesetReleaseIntents(changesetDirectory, dependencies);
  const versionDeltas = typeof dependencies.collectPackageVersionDeltas === 'function'
    ? dependencies.collectPackageVersionDeltas(baseRef)
    : collectPackageVersionDeltas(baseRef, dependencies);
  const disallowed = intents.filter((intent) => validBumps.has(intent.bump) && !allowedBumps.has(intent.bump));
  const disallowedVersionDeltas = versionDeltas.filter(
    (delta) => validBumps.has(delta.bump) && !allowedBumps.has(delta.bump),
  );
  const dependencyOnlyMajorVersionDeltas = typeof dependencies.collectDependencyOnlyMajorVersionDeltas === 'function'
    ? dependencies.collectDependencyOnlyMajorVersionDeltas(versionDeltas)
    : collectDependencyOnlyMajorVersionDeltas(versionDeltas, dependencies);

  if (disallowed.length > 0 || disallowedVersionDeltas.length > 0 || dependencyOnlyMajorVersionDeltas.length > 0) {
    const details = disallowed
      .map((intent) => `${intent.packageName}@${intent.bump} (${intent.filePath})`)
      .join('\n  - ');
    const versionDetails = disallowedVersionDeltas
      .map(
        (delta) =>
          `${delta.packageName}@${delta.bump} (${delta.previousVersion} -> ${delta.nextVersion}, ${delta.filePath})`,
      )
      .join('\n  - ');
    const sections = [
      details.length > 0 ? `changesets:\n  - ${details}` : '',
      versionDetails.length > 0 ? `package version deltas:\n  - ${versionDetails}` : '',
      dependencyOnlyMajorVersionDeltas.length > 0
        ? `dependency-only major package version deltas:\n  - ${dependencyOnlyMajorVersionDeltas
            .map(
              (delta) =>
                `${delta.packageName}@major (${delta.previousVersion} -> ${delta.nextVersion}, ${delta.filePath}, ${delta.changelogPath}: ${delta.reason})`,
            )
            .join('\n  - ')}`
        : '',
    ].filter((section) => section.length > 0);

    throw new Error(
      `Changeset release lane check failed: the ${lane} lane only allows ${[...allowedBumps].join(', ')} changesets and package version bumps with matching major changelog evidence:\n${sections.join('\n')}`,
    );
  }

  return {
    allowedBumps: [...allowedBumps],
    checkedDependencyOnlyMajorVersionDeltas: dependencyOnlyMajorVersionDeltas,
    checkedIntents: intents,
    checkedVersionDeltas: versionDeltas,
    lane,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  const result = verifyChangesetReleaseLane(options);

  console.log(
    `Changeset release lane check passed for ${result.lane}: ${String(result.checkedIntents.length)} pending package bump intent(s), ${String(result.checkedVersionDeltas.length)} package version delta(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
