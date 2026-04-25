import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const releaseNotesPath = join(scriptDirectory, 'github-release-notes.md');
const firstPackageScopedNotesVersion = '1.0.0-beta.2';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseReleaseTag(tag) {
  if (!tag) {
    throw new Error('Usage: node tooling/release/prepare-github-release.mjs <tag>');
  }

  if (tag.startsWith('v')) {
    return {
      packageName: null,
      tag,
      version: tag.slice(1),
    };
  }

  const scopedPackageMatch = tag.match(/^(?<packageName>@[^/]+\/[^@]+)@(?<version>.+)$/u);
  if (scopedPackageMatch?.groups) {
    return {
      packageName: scopedPackageMatch.groups.packageName,
      tag,
      version: scopedPackageMatch.groups.version,
    };
  }

  return {
    packageName: null,
    tag,
    version: tag,
  };
}

export function sectionForVersion(changelog, version) {
  const lines = changelog.split('\n');
  const headerRegex = new RegExp(`^## \\[${escapeRegExp(version)}\\] - `);
  const start = lines.findIndex((line) => headerRegex.test(line));

  if (start < 0) {
    throw new Error(`No CHANGELOG.md section found for version ${version}.`);
  }

  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## [')) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n').trim();
}

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
  const match = version.match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/u);

  if (!match?.groups) {
    throw new Error(`Cannot compare release version ${version}.`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease ?? '',
  };
}

function compareVersions(left, right) {
  const leftVersion = parseComparableVersion(left);
  const rightVersion = parseComparableVersion(right);

  for (const key of ['major', 'minor', 'patch']) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function requiresPackageScopedNotes(version) {
  return compareVersions(version, firstPackageScopedNotesVersion) >= 0;
}

function packageSubsectionHeadings(section) {
  return section
    .split('\n')
    .map((line, index) => {
      const match = line.match(/^###\s+(?<title>.+?)\s*$/u);

      return match?.groups ? { index, title: match.groups.title } : null;
    })
    .filter(Boolean);
}

export function packageSectionForVersion(section, packageName, version) {
  const lines = section.split('\n');
  const headings = packageSubsectionHeadings(section);
  const matchingHeadings = headings.filter((heading) => heading.title === packageName);

  if (matchingHeadings.length > 1) {
    throw new Error(`Duplicate package release notes found for ${packageName} ${version}.`);
  }

  const matchingHeading = matchingHeadings[0];

  if (!matchingHeading) {
    const packageHeadings = headings.filter((heading) => /^@[^/]+\/[^@]+$/u.test(heading.title));

    if (packageHeadings.length === 0) {
      throw new Error(
        `Ambiguous generic release notes found for ${packageName} ${version}; package releases after ${firstPackageScopedNotesVersion} require package-specific notes instead of shared generic notes.`,
      );
    }

    throw new Error(`Missing package release notes for ${packageName} ${version}; add a \`### ${packageName}\` subsection.`);
  }

  const nextHeading = headings.find((heading) => heading.index > matchingHeading.index);
  const versionHeader = lines[0];
  const packageLines = lines.slice(matchingHeading.index, nextHeading?.index ?? lines.length).join('\n').trim();

  return [versionHeader, '', packageLines].join('\n').trim();
}

export function buildGitHubReleaseNotes(tag, changelog) {
  const { packageName, version } = parseReleaseTag(tag);
  const section = sectionForVersion(changelog, version);
  const releaseSection = packageName && requiresPackageScopedNotes(version) ? packageSectionForVersion(section, packageName, version) : section;

  return [
    `# ${tag}`,
    '',
    ...(packageName ? [`- Release package: \`${packageName}\``, ''] : []),
    releaseSection,
    '',
    '---',
    '',
    'Release-readiness verification summary is attached as `release-readiness-summary.md`.',
  ].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const tag = argv[0];

  if (!tag) {
    throw new Error('Usage: node tooling/release/prepare-github-release.mjs <tag>');
  }

  const changelog = readFileSync(changelogPath, 'utf8');
  const notes = buildGitHubReleaseNotes(tag, changelog);

  writeFileSync(releaseNotesPath, `${notes}\n`, 'utf8');
  console.log(`GitHub release notes written to ${releaseNotesPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
