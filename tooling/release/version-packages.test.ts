import { describe, expect, it } from 'vitest';
import { normalizePackageChangelog, runVersionPackages } from './version-packages.mjs';

describe('normalizePackageChangelog', () => {
  it('adds Unreleased below a foundation package title when the section is missing', () => {
    const changelog = '# @fluojs/core\n\n## 1.0.3\n\n- Latest release.\n';

    expect(normalizePackageChangelog(changelog)).toBe(
      '# @fluojs/core\n\n## [Unreleased]\n\n## 1.0.3\n\n- Latest release.\n',
    );
  });

  it('moves foundation Unreleased content above newly generated release history', () => {
    const changelog = [
      '# @fluojs/core',
      '',
      '## 1.0.4',
      '',
      '- Generated release.',
      '',
      '## [Unreleased]',
      '',
      '- Pending note.',
      '',
      '## 1.0.3',
      '',
      '- Previous release.',
      '',
    ].join('\n');

    expect(normalizePackageChangelog(changelog)).toBe(
      [
        '# @fluojs/core',
        '',
        '## [Unreleased]',
        '',
        '- Pending note.',
        '',
        '## 1.0.4',
        '',
        '- Generated release.',
        '',
        '## 1.0.3',
        '',
        '- Previous release.',
        '',
      ].join('\n'),
    );
  });

  it('rejects duplicate Unreleased sections', () => {
    const changelog = '# @fluojs/core\n\n## [Unreleased]\n\n## [Unreleased]\n';

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

  it('writes nothing when a later changed changelog is invalid', () => {
    const drizzleChangelogPath = '/repo/packages/drizzle/CHANGELOG.md';
    const prismaChangelogPath = '/repo/packages/prisma/CHANGELOG.md';
    const changelogs = new Map([
      [drizzleChangelogPath, '# @fluojs/drizzle\n\n## [Unreleased]\n\n## 1.1.0\n'],
      [prismaChangelogPath, '# @fluojs/prisma\n\n## [Unreleased]\n\n## 1.1.0\n'],
    ]);
    const writes: string[] = [];

    expect(() =>
      runVersionPackages({
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
            drizzleChangelogPath,
            '# @fluojs/drizzle\n\n## 1.1.1\n\n- Generated release.\n\n## [Unreleased]\n\n## 1.1.0\n',
          );
          changelogs.set(
            prismaChangelogPath,
            '# @fluojs/prisma\n\n## [Unreleased]\n\n## [Unreleased]\n\n## 1.1.0\n',
          );
        },
        workspacePackageManifests: () => [
          {
            manifest: { name: '@fluojs/drizzle', publishConfig: { access: 'public' } },
            packageJsonPath: '/repo/packages/drizzle/package.json',
          },
          {
            manifest: { name: '@fluojs/prisma', publishConfig: { access: 'public' } },
            packageJsonPath: '/repo/packages/prisma/package.json',
          },
        ],
        writeFileSync: (targetPath, content) => {
          writes.push(targetPath);
          changelogs.set(targetPath, content);
        },
      }),
    ).toThrowError('Package CHANGELOG.md must contain at most one `## [Unreleased]` section.');
    expect(writes).toEqual([]);
  });
});
