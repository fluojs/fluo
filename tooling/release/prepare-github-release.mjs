import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const releaseNotesPath = join(scriptDirectory, 'github-release-notes.md');

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

export function buildGitHubReleaseNotes(tag, changelog) {
  const { packageName, version } = parseReleaseTag(tag);
  const section = sectionForVersion(changelog, version);

  return [
    `# ${tag}`,
    '',
    ...(packageName ? [`- Release package: \`${packageName}\``, ''] : []),
    section,
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
