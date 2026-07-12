import { describe, expect, it } from 'vitest';
import { normalizePackageChangelog, runVersionPackages } from './version-packages.mjs';

describe('normalizePackageChangelog', () => {
  it('adds Unreleased below the package title when the section is missing', () => {
    const changelog = '# @fluojs/core\n\n## 1.0.3\n\n- Latest release.\n';

    const normalized = normalizePackageChangelog(changelog);

    expect(normalized).toBe('# @fluojs/core\n\n## [Unreleased]\n\n## 1.0.3\n\n- Latest release.\n');
  });

  it('moves Unreleased content above newly generated release history', () => {
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

    const normalized = normalizePackageChangelog(changelog);

    expect(normalized).toBe(
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
    const coreChangelogPath = '/repo/packages/core/CHANGELOG.md';
    const runtimeChangelogPath = '/repo/packages/runtime/CHANGELOG.md';
    const changelogs = new Map([
      [coreChangelogPath, '# @fluojs/core\n\n## 1.0.3\n'],
      [runtimeChangelogPath, '# @fluojs/runtime\n\n## 1.0.0\n'],
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
        changelogs.set(coreChangelogPath, '# @fluojs/core\n\n## 1.0.4\n\n- Generated release.\n\n## 1.0.3\n');
      },
      workspacePackageManifests: () => [
        {
          manifest: { name: '@fluojs/core', publishConfig: { access: 'public' } },
          packageJsonPath: '/repo/packages/core/package.json',
        },
        {
          manifest: { name: '@fluojs/runtime', publishConfig: { access: 'public' } },
          packageJsonPath: '/repo/packages/runtime/package.json',
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

    expect(result.normalizedChangelogPaths).toEqual([coreChangelogPath]);
    expect(writes).toEqual([coreChangelogPath]);
    expect(changelogs.get(coreChangelogPath)).toContain('# @fluojs/core\n\n## [Unreleased]\n\n## 1.0.4');
    expect(changelogs.get(runtimeChangelogPath)).toBe('# @fluojs/runtime\n\n## 1.0.0\n');
  });
});
