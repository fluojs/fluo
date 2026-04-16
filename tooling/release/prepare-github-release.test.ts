import { describe, expect, it } from 'vitest';
import { buildGitHubReleaseNotes, parseReleaseTag, sectionForVersion } from './prepare-github-release.mjs';

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
});
