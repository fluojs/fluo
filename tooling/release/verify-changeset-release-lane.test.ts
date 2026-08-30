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

function writeChangeset(directory: string, fileName: string, frontmatter: string, body = 'Release note.') {
  writeFileSync(join(directory, fileName), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
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

  it('skips package manifests added after the base ref instead of treating them as version deltas', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'react-scaffold.md', '"@fluojs/react": minor');

    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      {
        runGit: (args: string[]) => {
          const command = args.join(' ');

          if (command === 'diff --name-only origin/main -- packages/*/package.json') {
            return 'packages/react/package.json\n';
          }

          if (command === 'cat-file -e origin/main:packages/react/package.json') {
            throw new Error("fatal: path 'packages/react/package.json' exists on disk, but not in 'origin/main'");
          }

          throw new Error(`unexpected git command: ${command}`);
        },
      },
    );

    expect(result.checkedIntents).toMatchObject([{ bump: 'minor', packageName: '@fluojs/react' }]);
    expect(result.checkedVersionDeltas).toEqual([]);
  });

  it('fails closed when base-ref package manifest probing fails for an unexpected git error', () => {
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'react-scaffold.md', '"@fluojs/react": minor');

    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/missing', changesetDirectory: directory, lane: 'stable' },
        {
          runGit: (args: string[]) => {
            const command = args.join(' ');

            if (command === 'diff --name-only origin/missing -- packages/*/package.json') {
              return 'packages/react/package.json\n';
            }

            if (command === 'cat-file -e origin/missing:packages/react/package.json') {
              throw new Error("fatal: invalid object name 'origin/missing'.");
            }

            throw new Error(`unexpected git command: ${command}`);
          },
        },
      ),
    ).toThrow(/invalid object name 'origin\/missing'/u);
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

  it('rejects patch changesets that describe public CLI feature additions', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-studio-live-mode.md',
      '"@fluojs/cli": patch',
      'Add the runtime-connected Studio devtool path with `fluo dev --studio` and sidecar lifecycle events.',
    );

    expect(() => verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' })).toThrow(
      /public CLI feature additions classified as patch.*fluo dev --studio/us,
    );
  });

  it('allows patch changesets that preserve existing CLI behavior without additive feature language', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-report-fix.md',
      '"@fluojs/cli": patch',
      'Fix `fluo inspect --report` summary validation without changing the documented artifact contract.',
    );

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'patch', packageName: '@fluojs/cli' }]);
    expect(result.checkedPatchCliFeatureDowngrades).toEqual([]);
  });

  it('allows patch changesets that add validation for documented CLI artifact parity without changing the contract', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-report-validation.md',
      '"@fluojs/cli": patch',
      'Add validation for `fluo inspect --report` output parity without changing the documented artifact contract.',
    );

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'patch', packageName: '@fluojs/cli' }]);
    expect(result.checkedPatchCliFeatureDowngrades).toEqual([]);
  });

  it('rejects patch changesets that add README-documented CLI commands outside the prior fixed marker list', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-static-preview-serve.md',
      '"@fluojs/cli": patch',
      'Add `fluo serve` command for README-documented static preview workflows.',
    );

    expect(() =>
      verifyChangesetReleaseLane(
        { changesetDirectory: directory, lane: 'stable' },
        {
          readCliReadme: () =>
            '# @fluojs/cli\n\n## Static Preview\n\n```bash\nfluo serve ./dist --static-preview\n```\n\nUse `fluo serve` for README-documented static preview workflows.\n',
        },
      ),
    ).toThrow(/public CLI feature additions classified as patch.*fluo serve/us);
  });

  it('rejects patch changesets that allow README-documented CLI commands', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-static-preview-serve.md',
      '"@fluojs/cli": patch',
      'Allow `fluo serve` command for README-documented static preview workflows.',
    );

    expect(() =>
      verifyChangesetReleaseLane(
        { changesetDirectory: directory, lane: 'stable' },
        {
          readCliReadme: () =>
            '# @fluojs/cli\n\n## Static Preview\n\n```bash\nfluo serve ./dist --static-preview\n```\n\nUse `fluo serve` for README-documented static preview workflows.\n',
        },
      ),
    ).toThrow(/public CLI feature additions classified as patch.*fluo serve/us);
  });

  it('allows patch changesets that add lifecycle guardrails without changing documented behavior', () => {
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'cli-lifecycle-guardrails.md',
      '"@fluojs/cli": patch',
      'Added lifecycle guardrails to avoid duplicate restart loops without changing the documented behavior.',
    );

    const result = verifyChangesetReleaseLane({ changesetDirectory: directory, lane: 'stable' });

    expect(result.checkedIntents).toMatchObject([{ bump: 'patch', packageName: '@fluojs/cli' }]);
    expect(result.checkedPatchCliFeatureDowngrades).toEqual([]);
  });

  it('rejects generated patch changelog sections that describe public CLI feature additions', () => {
    const directory = createChangesetDirectory();

    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        {
          collectPackageVersionDeltas: () => [
            {
              bump: 'patch',
              filePath: 'packages/cli/package.json',
              nextVersion: '1.0.7',
              packageName: '@fluojs/cli',
              previousVersion: '1.0.6',
            },
          ],
          existsSync: (targetPath: string) => targetPath.endsWith('packages/cli/CHANGELOG.md'),
          readFileSync: () =>
            '# @fluojs/cli\n\n## 1.0.7\n\n### Patch Changes\n\n- Support documented TypeScript source module paths in `fluo inspect`.\n',
        },
      ),
    ).toThrow(/public CLI feature additions classified as patch.*fluo inspect/us);
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
