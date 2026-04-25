import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGitHubReleaseNotes, parseReleaseTag, sectionForVersion } from './prepare-github-release.mjs';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), 'utf8');
}

describe('parseReleaseTag', () => {
  it('keeps legacy v-prefixed tags mapped to the matching changelog version', () => {
    expect(parseReleaseTag('v0.2.0')).toEqual({
      packageName: null,
      tag: 'v0.2.0',
      version: '0.2.0',
    });
  });

  it('extracts package and version from scoped package tags', () => {
    expect(parseReleaseTag('@fluojs/cli@0.2.0-beta.1')).toEqual({
      packageName: '@fluojs/cli',
      tag: '@fluojs/cli@0.2.0-beta.1',
      version: '0.2.0-beta.1',
    });
  });
});

describe('sectionForVersion', () => {
  it('returns the exact changelog section for the requested version', () => {
    const changelog = `# Changelog\n\n## [0.2.0] - 2026-04-16\n\n### Added\n\n- Shipped release automation.\n\n## [0.1.0] - 2026-04-15\n`;

    expect(sectionForVersion(changelog, '0.2.0')).toBe('## [0.2.0] - 2026-04-16\n\n### Added\n\n- Shipped release automation.');
  });
});

describe('buildGitHubReleaseNotes', () => {
  it('includes package metadata for single-package release tags', () => {
    const changelog = `# Changelog\n\n## [0.2.0] - 2026-04-16\n\n### Added\n\n- Shipped release automation.\n`;

    expect(buildGitHubReleaseNotes('@fluojs/cli@0.2.0', changelog)).toContain('- Release package: `@fluojs/cli`');
    expect(buildGitHubReleaseNotes('@fluojs/cli@0.2.0', changelog)).toContain('## [0.2.0] - 2026-04-16');
  });

  it('keeps legacy version-only notes compatible through 1.0.0-beta.1', () => {
    const changelog = readFixture('legacy-version-only-changelog.md');

    expect(buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.1', changelog)).toContain(
      'Bootstrap beta train for all 39 public `@fluojs/*` packages',
    );
    expect(buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.1', changelog)).toContain(
      '- Release package: `@fluojs/cli`',
    );
  });
});

describe('package-aware changelog fixtures', () => {
  it('defines valid package-specific extraction format for @fluojs/cli@1.0.0-beta.2', () => {
    const changelog = readFixture('package-scoped-changelog.md');
    const section = sectionForVersion(changelog, '1.0.0-beta.2');

    expect(section).toContain('## [1.0.0-beta.2] - 2026-04-25');
    expect(section).toContain('### @fluojs/cli');
    expect(section).toContain('- CLI package-specific release note for beta.2.');
  });

  it('defines same-version multi-package notes with isolated CLI and Studio subsections', () => {
    const section = sectionForVersion(readFixture('package-scoped-changelog.md'), '1.0.0-beta.2');
    const cliStart = section.indexOf('### @fluojs/cli');
    const studioStart = section.indexOf('### @fluojs/studio');
    const cliNotes = section.slice(cliStart, studioStart);
    const studioNotes = section.slice(studioStart);

    expect(cliStart).toBeGreaterThan(-1);
    expect(studioStart).toBeGreaterThan(cliStart);
    expect(cliNotes).toContain('- CLI package-specific release note for beta.2.');
    expect(cliNotes).not.toContain('- Studio package-specific release note for beta.2.');
    expect(studioNotes).toContain('- Studio package-specific release note for beta.2.');
    expect(studioNotes).not.toContain('- CLI package-specific release note for beta.2.');
  });

  it('documents missing package notes after the cutoff as a future package-specific error', () => {
    const section = sectionForVersion(readFixture('missing-package-changelog.md'), '1.0.0-beta.2');

    expect(section).toContain('### @fluojs/studio');
    expect(section).not.toContain('### @fluojs/cli');
  });

  it('documents ambiguous generic version-only notes after the cutoff for package release extraction', () => {
    const section = sectionForVersion(readFixture('ambiguous-version-only-changelog.md'), '1.0.0-beta.2');

    expect(section).toContain('### Changed');
    expect(section).toContain('Generic beta.2 note without a package subsection.');
    expect(section).not.toContain('### @fluojs/cli');
    expect(section).not.toContain('### @fluojs/studio');
  });

  it('extracts only valid package-specific notes for @fluojs/cli@1.0.0-beta.2', () => {
    const notes = buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.2', readFixture('package-scoped-changelog.md'));

    expect(notes).toContain('- Release package: `@fluojs/cli`');
    expect(notes).toContain('## [1.0.0-beta.2] - 2026-04-25');
    expect(notes).toContain('### @fluojs/cli');
    expect(notes).toContain('- CLI package-specific release note for beta.2.');
    expect(notes).not.toContain('### @fluojs/studio');
    expect(notes).not.toContain('- Studio package-specific release note for beta.2.');
  });

  it('throws a package/version-specific error when @fluojs/cli@1.0.0-beta.2 notes are missing', () => {
    expect(() => buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.2', readFixture('missing-package-changelog.md'))).toThrow(
      /Missing package release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u,
    );
  });

  it('rejects ambiguous generic version-only notes after 1.0.0-beta.1 for package releases', () => {
    expect(() => buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.2', readFixture('ambiguous-version-only-changelog.md'))).toThrow(
      /Ambiguous generic release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u,
    );
  });

  it('throws a package/version-specific error when duplicate package notes exist', () => {
    const changelog = `# Changelog

## [1.0.0-beta.2] - 2026-04-25

### @fluojs/cli

- First CLI note.

### @fluojs/cli

- Duplicate CLI note.
`;

    expect(() => buildGitHubReleaseNotes('@fluojs/cli@1.0.0-beta.2', changelog)).toThrow(
      /Duplicate package release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u,
    );
  });

  it('requires package-specific notes for later prerelease and stable versions', () => {
    for (const version of ['1.0.0-beta.10', '1.0.0-rc.0', '1.0.0']) {
      const changelog = `# Changelog

## [${version}] - 2026-04-25

### Changed

- Generic post-cutoff note.
`;

      expect(() => buildGitHubReleaseNotes(`@fluojs/cli@${version}`, changelog)).toThrow(
        new RegExp(`Ambiguous generic release notes.*@fluojs/cli.*${version.replace(/\./gu, '\\.')}`, 'u'),
      );
    }
  });
});
