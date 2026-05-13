import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChangesetReleaseLane } from './verify-changeset-release-lane.mjs';

const temporaryDirectories: string[] = [];

function createChangesetDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-changeset-lane-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeChangeset(directory: string, fileName: string, frontmatter: string) {
  writeFileSync(join(directory, fileName), `---\n${frontmatter}\n---\n\nRelease note.\n`, 'utf8');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('verifyChangesetReleaseLane', () => {
  it('allows patch-only changesets on the stable lane', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'fix-runtime.md', '"@fluojs/runtime": patch');
    writeChangeset(directory, 'fix-core.md', "'@fluojs/core': patch");

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toHaveLength(2);
    expect(result.allowedBumps).toEqual(['patch']);
  });

  it('allows patch package version deltas on the stable lane', () => {
    const directory = createChangesetDirectory();

    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      {
        collectPackageVersionDeltas: () => [
          {
            bump: 'patch',
            filePath: 'packages/runtime/package.json',
            nextVersion: '1.0.1',
            packageName: '@fluojs/runtime',
            previousVersion: '1.0.0',
          },
        ],
      },
    );

    expect(result.checkedVersionDeltas).toHaveLength(1);
  });

  it('rejects minor and major changesets on the stable lane', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'feature-runtime.md', '"@fluojs/runtime": minor');
    writeChangeset(directory, 'breaking-slack.md', '"@fluojs/slack": major');

    expect(() => verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' })).toThrow(
      /@fluojs\/slack@major[\s\S]*@fluojs\/runtime@minor/,
    );
  });

  it('rejects generated minor and major package version deltas on the stable lane', () => {
    const directory = createChangesetDirectory();

    expect(() =>
      verifyChangesetReleaseLane(
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
        },
      ),
    ).toThrow(/@fluojs\/runtime@major[\s\S]*1\.0\.0 -> 2\.0\.0/);
  });

  it('allows all semver bump intents on the prerelease lane', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'feature-runtime.md', '"@fluojs/runtime": minor');
    writeChangeset(directory, 'breaking-slack.md', '"@fluojs/slack": major');

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'prerelease' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'major' }, { bump: 'minor' }]);
  });

  it('ignores the generated Changesets README', () => {
    const directory = createChangesetDirectory();
    writeFileSync(join(directory, 'README.md'), '# Changesets\n', 'utf8');

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toEqual([]);
  });
});
