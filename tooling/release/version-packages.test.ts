import { describe, expect, it } from 'vitest';
import { normalizePackageChangelog, runVersionPackages } from './version-packages.mjs';

describe('normalizePackageChangelog', () => {
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
});

describe('runVersionPackages', () => {
  it('normalizes only public package changelogs changed by Changesets', () => {
    const prismaChangelogPath = '/repo/packages/prisma/CHANGELOG.md';
    const drizzleChangelogPath = '/repo/packages/drizzle/CHANGELOG.md';
    const changelogs = new Map([
      [prismaChangelogPath, '# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.0\n'],
      [drizzleChangelogPath, '# @fluojs/drizzle\n\n## [Unreleased]\n\n## 1.1.0\n'],
    ]);
    const writes: string[] = [];

    const result = runVersionPackages({
      existsSync: (targetPath) => changelogs.has(targetPath),
      readFileSync: (targetPath) => {
        const changelog = changelogs.get(targetPath);

        if (changelog === undefined) {
          throw new Error(`Unexpected changelog read: ${targetPath}`);
        }

        return changelog;
      },
      runChangesetsVersion: () => {
        changelogs.set(
          prismaChangelogPath,
          '# @fluojs/prisma\n\n## 1.1.1\n\n- Generated release.\n\n## [Unreleased]\n\n## 1.1.0\n',
        );
      },
      workspacePackageManifests: () => [
        {
          manifest: { name: '@fluojs/prisma', publishConfig: { access: 'public' } },
          packageJsonPath: '/repo/packages/prisma/package.json',
        },
        {
          manifest: { name: '@fluojs/drizzle', publishConfig: { access: 'public' } },
          packageJsonPath: '/repo/packages/drizzle/package.json',
        },
        {
          manifest: { name: '@fluojs/private', private: true },
          packageJsonPath: '/repo/packages/private/package.json',
        },
      ],
      writeFileSync: (targetPath, content) => {
        writes.push(targetPath);
        changelogs.set(targetPath, content);
      },
    });

    expect(result.normalizedChangelogPaths).toEqual([prismaChangelogPath]);
    expect(writes).toEqual([prismaChangelogPath]);
    expect(changelogs.get(prismaChangelogPath)).toContain(
      '# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.1',
    );
    expect(changelogs.get(drizzleChangelogPath)).toBe(
      '# @fluojs/drizzle\n\n## [Unreleased]\n\n## 1.1.0\n',
    );
  });
});
