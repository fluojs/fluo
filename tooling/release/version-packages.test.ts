import { describe, expect, it } from 'vitest';
import { normalizePackageChangelog, runChangesetsVersion, runVersionPackages } from './version-packages.mjs';

describe('runChangesetsVersion', () => {
  const transientStderr = [
    '🦋  error Error: Failed to parse data from GitHub',
    '🦋  error invalid json response body at https://api.github.com/graphql reason: Unexpected end of JSON input',
  ].join('\n');

  function createSpawnScript(script: readonly ('transient' | 'success' | 'fatal')[]) {
    const spawnCalls: string[][] = [];
    return {
      spawnCalls,
      spawn: (_command: string, args: readonly string[]) => {
        spawnCalls.push([...args]);
        const outcome = script[Math.min(spawnCalls.length - 1, script.length - 1)];
        if (outcome === 'success') {
          return { status: 0, stdout: '🦋  All changesets have been consumed.\n', stderr: '' };
        }
        return {
          status: 1,
          stdout: '',
          stderr: outcome === 'transient' ? transientStderr : '🦋  error Could not resolve changesets config.',
        };
      },
    };
  }

  it('retries transient GitHub API failures until the command succeeds', () => {
    const { spawn, spawnCalls } = createSpawnScript(['transient', 'transient', 'success']);
    const sleeps: number[] = [];
    const outputChunks: string[] = [];

    expect(() =>
      runChangesetsVersion({
        spawn,
        sleep: (milliseconds) => {
          sleeps.push(milliseconds);
        },
        writeOutput: () => {},
      }),
    ).not.toThrow();
    expect(spawnCalls).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 5_000]);
  });

  it('does not retry non-transient failures', () => {
    const { spawn, spawnCalls } = createSpawnScript(['fatal']);

    expect(() => runChangesetsVersion({ spawn, sleep: () => {}, writeOutput: () => {} })).toThrowError(
      'Changesets version command failed with exit code 1.',
    );
    expect(spawnCalls).toHaveLength(1);
  });

  it('throws after exhausting every retry attempt on persistent transient failures', () => {
    const { spawn, spawnCalls } = createSpawnScript(['transient', 'transient', 'transient']);

    expect(() =>
      runChangesetsVersion({ attempts: 3, spawn, sleep: () => {}, writeOutput: () => {} }),
    ).toThrowError('Changesets version command failed with exit code 1.');
    expect(spawnCalls).toHaveLength(3);
  });
});

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
