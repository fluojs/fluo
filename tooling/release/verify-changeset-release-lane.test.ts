import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, verifyChangesetReleaseLane } from './verify-changeset-release-lane.mjs';

const temporaryDirectories: string[] = [];

function createChangesetDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-changeset-lane-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeChangeset(directory: string, fileName: string, frontmatter: string) {
  writeFileSync(join(directory, fileName), `---\n${frontmatter}\n---\n\nRelease note.\n`, 'utf8');
}

function writePackageChangelog(directory: string, packageDirectory: string, changelog: string) {
  const targetDirectory = join(directory, packageDirectory);
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(join(targetDirectory, 'CHANGELOG.md'), changelog, 'utf8');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('verifyChangesetReleaseLane', () => {
  it('allows patch, minor, and major changesets on the stable lane', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'fix-runtime.md', '"@fluojs/runtime": patch');
    writeChangeset(directory, 'feature-core.md', "'@fluojs/core': minor");
    writeChangeset(directory, 'breaking-slack.md', '"@fluojs/slack": major');

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'major' }, { bump: 'minor' }, { bump: 'patch' }]);
    expect(result.allowedBumps).toEqual(['patch', 'minor', 'major']);
  });

  it('allows patch, minor, and major package version deltas on the stable lane', () => {
    const directory = createChangesetDirectory();

    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      {
        collectPackageVersionDeltas: () => [
          {
            bump: 'patch',
            filePath: 'packages/http/package.json',
            nextVersion: '1.0.1',
            packageName: '@fluojs/http',
            previousVersion: '1.0.0',
          },
          {
            bump: 'minor',
            filePath: 'packages/core/package.json',
            nextVersion: '1.1.0',
            packageName: '@fluojs/core',
            previousVersion: '1.0.0',
          },
          {
            bump: 'major',
            filePath: 'packages/runtime/package.json',
            nextVersion: '2.0.0',
            packageName: '@fluojs/runtime',
            previousVersion: '1.0.0',
          },
        ],
        collectDependencyOnlyMajorVersionDeltas: () => [],
      },
    );

    expect(result.checkedVersionDeltas).toMatchObject([{ bump: 'patch' }, { bump: 'minor' }, { bump: 'major' }]);
  });

  it('rejects major package version deltas without major changelog evidence', () => {
    const directory = createChangesetDirectory();
    writePackageChangelog(
      directory,
      'packages/i18n',
      `# @fluojs/i18n\n\n## 2.0.0\n\n### Patch Changes\n\n- Updated dependencies:\n  - @fluojs/http@1.1.0\n`,
    );

    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        {
          collectPackageVersionDeltas: () => [
            {
              bump: 'major',
              filePath: 'packages/i18n/package.json',
              nextVersion: '2.0.0',
              packageName: '@fluojs/i18n',
              previousVersion: '1.0.2',
            },
          ],
          existsSync: (targetPath: string) => targetPath.endsWith('packages/i18n/CHANGELOG.md'),
          readFileSync: () =>
            `# @fluojs/i18n\n\n## 2.0.0\n\n### Patch Changes\n\n- Updated dependencies:\n  - @fluojs/http@1.1.0\n`,
        },
      ),
    ).toThrow(/dependency-only major package version deltas/u);
  });

  it('allows major package version deltas with major changelog evidence', () => {
    const directory = createChangesetDirectory();

    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      {
        collectPackageVersionDeltas: () => [
          {
            bump: 'major',
            filePath: 'packages/runtime/package.json',
            nextVersion: '2.0.0',
            packageName: '@fluojs/runtime',
            previousVersion: '1.0.0',
          },
        ],
        existsSync: (targetPath: string) => targetPath.endsWith('packages/runtime/CHANGELOG.md'),
        readFileSync: () =>
          `# @fluojs/runtime\n\n## 2.0.0\n\n### Major Changes\n\n- Remove a deprecated public API.\n`,
      },
    );

    expect(result.checkedDependencyOnlyMajorVersionDeltas).toEqual([]);
  });

  it('allows all semver bump intents on the prerelease lane', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'fix-runtime.md', '"@fluojs/runtime": patch');
    writeChangeset(directory, 'feature-core.md', '"@fluojs/core": minor');
    writeChangeset(directory, 'breaking-slack.md', '"@fluojs/slack": major');

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'prerelease' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'major' }, { bump: 'minor' }, { bump: 'patch' }]);
    expect(result.allowedBumps).toEqual(['patch', 'minor', 'major']);
  });

  it('rejects unknown lanes', () => {
    const directory = createChangesetDirectory();

    expect(() => main(['--lane=minor', '--changeset-dir', directory])).toThrow(/unknown lane "minor"/);
  });

  it('ignores the generated Changesets README', () => {
    const directory = createChangesetDirectory();
    writeFileSync(join(directory, 'README.md'), '# Changesets\n', 'utf8');

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toEqual([]);
  });
});
