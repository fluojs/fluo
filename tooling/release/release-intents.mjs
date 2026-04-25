import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');

export const firstEnforcedReleaseIntentVersion = '1.0.0-beta.2';
export const releaseIntentDispositions = ['release', 'no-release', 'downstream-evaluate'];
export const releaseIntentSemverIntents = ['patch', 'minor', 'major', 'none'];

function comparePrerelease(left, right) {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;

    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }

      continue;
    }

    if (leftNumber !== null) {
      return -1;
    }

    if (rightNumber !== null) {
      return 1;
    }

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

function parseComparableVersion(version) {
  const match = String(version).match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/u);

  if (!match?.groups) {
    throw new Error(`Cannot compare release intent version ${version}.`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease ?? '',
  };
}

export function compareVersions(left, right) {
  const leftVersion = parseComparableVersion(left);
  const rightVersion = parseComparableVersion(right);

  for (const key of ['major', 'minor', 'patch']) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function requiresReleaseIntentRecords(version) {
  return compareVersions(version, firstEnforcedReleaseIntentVersion) >= 0;
}

export function workspacePackageManifests(rootDirectory = repoRoot) {
  const packagesDirectory = join(rootDirectory, 'packages');
  const manifests = [];

  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(packagesDirectory, entry.name, 'package.json');

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    if (typeof manifest.name === 'string') {
      manifests.push({ manifest, packageJsonPath });
    }
  }

  return manifests.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

export function publicWorkspacePackageNames(packageManifests) {
  return packageManifests
    .filter(
      ({ manifest }) =>
        typeof manifest.name === 'string' &&
        manifest.name.startsWith('@fluojs/') &&
        manifest.private !== true &&
        manifest.publishConfig?.access === 'public',
    )
    .map(({ manifest }) => manifest.name)
    .sort((left, right) => left.localeCompare(right));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function locationFor(index) {
  return `packages[${index}]`;
}

export function validateReleaseIntentRecord(record, dependencies = {}) {
  const errors = [];
  const packageManifests = dependencies.packageManifests ?? workspacePackageManifests(dependencies.repoRoot ?? repoRoot);
  const publicPackageSet = new Set(dependencies.publicPackageNames ?? publicWorkspacePackageNames(packageManifests));

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Release intent validation failed: intent record must be an object.');
  }

  if (!isNonEmptyString(record.version)) {
    errors.push('version is required.');
  }

  if (!Array.isArray(record.packages) || record.packages.length === 0) {
    errors.push('packages must include at least one affected package entry.');
  }

  const seenPackages = new Set();

  for (const [index, packageIntent] of Array.isArray(record.packages) ? record.packages.entries() : []) {
    const location = locationFor(index);

    if (!packageIntent || typeof packageIntent !== 'object' || Array.isArray(packageIntent)) {
      errors.push(`${location} must be an object.`);
      continue;
    }

    if (!isNonEmptyString(packageIntent.package)) {
      errors.push(`${location}.package is required.`);
    } else if (!publicPackageSet.has(packageIntent.package)) {
      errors.push(`${location}.package references unknown public workspace package ${packageIntent.package}.`);
    } else if (seenPackages.has(packageIntent.package)) {
      errors.push(`${location}.package duplicates ${packageIntent.package}.`);
    } else {
      seenPackages.add(packageIntent.package);
    }

    if (!releaseIntentDispositions.includes(packageIntent.disposition)) {
      errors.push(`${location}.disposition must be one of ${releaseIntentDispositions.join(', ')}.`);
    }

    if (!releaseIntentSemverIntents.includes(packageIntent.semver)) {
      errors.push(`${location}.semver must be one of ${releaseIntentSemverIntents.join(', ')}.`);
    }

    if (packageIntent.disposition === 'release' && packageIntent.semver === 'none') {
      errors.push(`${location}.semver must be patch, minor, or major when disposition is release.`);
    }

    if (
      (packageIntent.disposition === 'no-release' || packageIntent.disposition === 'downstream-evaluate') &&
      packageIntent.semver !== 'none'
    ) {
      errors.push(`${location}.semver must be none when disposition is ${packageIntent.disposition}.`);
    }

    if (!isNonEmptyString(packageIntent.summary)) {
      errors.push(`${location}.summary is required.`);
    }

    if (!isNonEmptyString(packageIntent.rationale)) {
      errors.push(`${location}.rationale is required.`);
    }

    const isBreakingIntent = packageIntent.semver === 'major' || packageIntent.breaking === true;
    if (isBreakingIntent && !isNonEmptyString(packageIntent.migrationNote)) {
      errors.push(`${location}.migrationNote is required for major or breaking release intents.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Release intent validation failed: ${errors.join(' ')}`);
  }

  return {
    packages: record.packages.map((packageIntent) => ({ ...packageIntent })),
    version: record.version,
  };
}

export function validateReleaseIntentRecords(records, options = {}) {
  const candidateVersion = options.candidateVersion;

  if (!isNonEmptyString(candidateVersion)) {
    throw new Error('Release intent validation failed: candidateVersion is required.');
  }

  const normalizedRecords = Array.isArray(records) ? records : records && typeof records === 'object' ? [records] : [];

  if (normalizedRecords.length === 0 && !requiresReleaseIntentRecords(candidateVersion)) {
    return [];
  }

  if (normalizedRecords.length === 0) {
    throw new Error(
      `Release intent validation failed: release intent records are required for ${candidateVersion}; ${firstEnforcedReleaseIntentVersion} is the first enforced fixture/candidate version.`,
    );
  }

  return normalizedRecords.map((record) => validateReleaseIntentRecord(record, options));
}
