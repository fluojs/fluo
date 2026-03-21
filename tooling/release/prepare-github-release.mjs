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

function sectionForVersion(changelog, version) {
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

const tag = process.argv[2];

if (!tag) {
  throw new Error('Usage: node tooling/release/prepare-github-release.mjs <tag>');
}

const version = tag.startsWith('v') ? tag.slice(1) : tag;
const changelog = readFileSync(changelogPath, 'utf8');
const section = sectionForVersion(changelog, version);
const notes = [
  `# ${tag}`,
  '',
  section,
  '',
  '---',
  '',
  'Release-candidate verification summary is attached as `release-candidate-summary.md`.',
].join('\n');

writeFileSync(releaseNotesPath, `${notes}\n`, 'utf8');
console.log(`GitHub release notes written to ${releaseNotesPath}`);
