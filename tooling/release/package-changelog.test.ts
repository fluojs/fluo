import { describe, expect, it } from 'vitest';
import {
  normalizePackageChangelog,
  packageChangelogContractViolation,
} from './package-changelog.mjs';

describe('normalizePackageChangelog', () => {
  it('is idempotent for a canonical package changelog', () => {
    const changelog = '# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.0\n\n- Latest release.\n';

    expect(normalizePackageChangelog(changelog)).toBe(changelog);
  });

  it('adds Unreleased below the package title when the section is missing', () => {
    const changelog = '# @fluojs/prisma\n\n## 1.1.0\n\n- Latest release.\n';

    const normalized = normalizePackageChangelog(changelog);

    expect(normalized).toBe('# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.0\n\n- Latest release.\n');
  });

  it('moves existing Unreleased content above generated release history', () => {
    const changelog = [
      '# @fluojs/prisma',
      '',
      '## 1.1.1',
      '',
      '- Generated release.',
      '',
      '## [Unreleased]',
      '',
      '- Pending note.',
      '',
      '## 1.1.0',
      '',
      '- Previous release.',
      '',
    ].join('\n');

    const normalized = normalizePackageChangelog(changelog);

    expect(normalized).toBe(
      [
        '# @fluojs/prisma',
        '',
        '## [Unreleased]',
        '',
        '- Pending note.',
        '',
        '## 1.1.1',
        '',
        '- Generated release.',
        '',
        '## 1.1.0',
        '',
        '- Previous release.',
        '',
      ].join('\n'),
    );
  });

  it('rejects duplicate Unreleased sections', () => {
    const changelog = '# @fluojs/prisma\n\n## [Unreleased]\n\n## [Unreleased]\n';

    expect(() => normalizePackageChangelog(changelog)).toThrowError(
      'Package CHANGELOG.md must contain at most one `## [Unreleased]` section.',
    );
  });

  it.each([
    ['suffix text', '## [Unreleased] draft'],
    ['the wrong heading level', '### [Unreleased]'],
    ['missing heading whitespace', '##[Unreleased]'],
  ])('rejects an Unreleased heading with %s', (_caseName, heading) => {
    const changelog = `# @fluojs/prisma\n\n${heading}\n\n## 1.1.0\n`;

    expect(() => normalizePackageChangelog(changelog)).toThrowError(
      'Package CHANGELOG.md must use the exact standalone `## [Unreleased]` heading.',
    );
  });

  it('ignores fenced Unreleased examples when counting headings', () => {
    const changelog = [
      '# @fluojs/prisma',
      '',
      '## [Unreleased]',
      '',
      '```md',
      '## [Unreleased]',
      '```',
      '',
      '## 1.1.0',
      '',
    ].join('\n');

    expect(normalizePackageChangelog(changelog)).toBe(changelog);
  });

  it('adds a canonical heading when Unreleased appears only in a fenced example', () => {
    const changelog = [
      '# @fluojs/prisma',
      '',
      '```md',
      '## [Unreleased]',
      '```',
      '',
      '## 1.1.0',
      '',
    ].join('\n');

    expect(normalizePackageChangelog(changelog)).toBe(
      [
        '# @fluojs/prisma',
        '',
        '## [Unreleased]',
        '',
        '```md',
        '## [Unreleased]',
        '```',
        '',
        '## 1.1.0',
        '',
      ].join('\n'),
    );
  });
});

describe('packageChangelogContractViolation', () => {
  it('accepts one standalone Unreleased heading immediately below the title', () => {
    expect(
      packageChangelogContractViolation('# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.0\n'),
    ).toBeUndefined();
  });

  it.each([
    ['a missing heading', '# @fluojs/prisma\n\n## 1.1.0\n'],
    ['suffix text', '# @fluojs/prisma\n\n## [Unreleased] draft\n\n## 1.1.0\n'],
    ['a fenced-only occurrence', '# @fluojs/prisma\n\n```md\n## [Unreleased]\n```\n\n## 1.1.0\n'],
    ['duplicate headings', '# @fluojs/prisma\n\n## [Unreleased]\n\n## [Unreleased]\n'],
    ['a misplaced heading', '# @fluojs/prisma\n\n## 1.1.0\n\n## [Unreleased]\n'],
    ['the wrong heading level', '# @fluojs/prisma\n\n### [Unreleased]\n\n## 1.1.0\n'],
  ])('rejects %s', (_caseName, changelog) => {
    expect(packageChangelogContractViolation(changelog)).toBeTypeOf('string');
  });
});
