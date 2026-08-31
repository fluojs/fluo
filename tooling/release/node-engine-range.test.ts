import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { narrowsStableNodeEngineRange } from './node-engine-range.mjs';
import { verifyChangesetReleaseLane } from './verify-changeset-release-lane.mjs';

const temporaryDirectories: string[] = [];

function createChangesetDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-node-engine-range-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeChangeset(directory: string, bump: 'major' | 'patch', body: string) {
  writeFileSync(join(directory, 'graphql.md'), `---\n"@fluojs/graphql": ${bump}\n---\n\n${body}\n`, 'utf8');
}

function publishedGraphqlDependencies(
  nextEngineRange: string,
  previousEngineRange = '>=20.16.0 <21 || >=22.0.0 <27',
  previousVersion = '1.1.0',
  nextVersion = '1.1.0',
) {
  return {
    collectPackageVersionDeltas: () => [],
    readFileSync: (filePath: string) =>
      filePath.endsWith('packages/graphql/package.json')
        ? JSON.stringify({
            engines: { node: nextEngineRange },
            name: '@fluojs/graphql',
            version: nextVersion,
          })
        : readFileSync(filePath, 'utf8'),
    runGit: (args: string[]) => {
      const command = args.join(' ');

      if (command === 'diff --name-only origin/main -- packages/*/package.json') {
        return 'packages/graphql/package.json\n';
      }

      if (command === 'tag --merged HEAD --list @fluojs/graphql@*') {
        return '@fluojs/graphql@1.1.0\n';
      }

      if (command === 'show @fluojs/graphql@1.1.0:packages/graphql/package.json') {
        return JSON.stringify({
          engines: { node: previousEngineRange },
          name: '@fluojs/graphql',
          version: previousVersion,
        });
      }

      throw new Error(`unexpected git command: ${command}`);
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('narrowsStableNodeEngineRange', () => {
  it.each([
    ['caret unions', '^20.0.0 || ^22.0.0', '^20.0.0', true],
    ['tilde unions', '~20.1.0 || ~22.2.0', '~20.1.0', true],
    ['x-range unions', '20.x || 22.x', '20.x', true],
    ['star ranges', '*', '>=20.0.0 <23.0.0', true],
    ['hyphen unions', '20.0.0 - 20.9.0 || 22.0.0 - 22.9.0', '20.0.0 - 20.9.0', true],
    ['mixed comparator unions', '>=20.0.0 <21.0.0 || ^22.0.0', '^20.0.0', true],
    ['mixed removal and addition', '>=20.0.0 <23.0.0', '>=21.0.0 <24.0.0', true],
    ['mixed union removal and addition', '>=20.0.0 <21.0.0 || >=22.0.0 <23.0.0', '>=21.0.0 <24.0.0', true],
    ['widened support', '>=20.0.0 <21.0.0', '>=20.0.0 <22.0.0', false],
    ['equivalent range syntax', '^20.0.0 || ^22.0.0', '>=20.0.0 <21.0.0 || >=22.0.0 <23.0.0', false],
    ['split adjacent union equivalence', '>=20.0.0 <23.0.0', '>=20.0.0 <21.0.0 || >=21.0.0 <23.0.0', false],
    ['merged adjacent union equivalence', '>=20.0.0 <21.0.0 || >=21.0.0 <23.0.0', '>=20.0.0 <23.0.0', false],
  ])('detects support removal for %s', (_fixture, previousRange, nextRange, expected) => {
    // Given: an Official package's published and candidate Node ranges.
    // When: the verifier compares their supported version sets.
    // Then: it reports only removed support.
    expect(narrowsStableNodeEngineRange('1.1.0', previousRange, nextRange)).toBe(expected);
  });

  it('fails closed for an unverifiable candidate range change', () => {
    // Given: a published Official range and unsupported candidate syntax.
    // When: the candidate cannot be normalized.
    // Then: release metadata must take the breaking-change path.
    expect(narrowsStableNodeEngineRange('1.1.0', '>=20.0.0 <23.0.0', '>=20.0.0 || unsupported')).toBe(true);
  });

  it.each(['0.9.0', '1.0.0-preview.1'])('exempts Preview package version %s', (version) => {
    // Given: a Preview package version.
    // When: its Node range becomes narrower.
    // Then: Official-tier major enforcement does not apply.
    expect(narrowsStableNodeEngineRange(version, '>=20.0.0 <23.0.0', '>=22.0.0 <23.0.0')).toBe(false);
  });

  it('exempts a Preview candidate release', () => {
    // Given: a stable published package and a prerelease candidate.
    // When: the candidate narrows supported Node versions.
    // Then: Preview policy exempts it from Official-tier major enforcement.
    expect(
      narrowsStableNodeEngineRange('1.1.0', '>=20.0.0 <23.0.0', '>=22.0.0 <23.0.0', '2.0.0-preview.1'),
    ).toBe(false);
  });

  it('keeps stable build metadata Official', () => {
    // Given: published and candidate Official versions with SemVer build metadata.
    // When: the candidate removes a supported Node version.
    // Then: build metadata does not bypass Official-tier enforcement.
    expect(
      narrowsStableNodeEngineRange('1.1.0+build.7', '>=20.0.0 <23.0.0', '>=21.0.0 <23.0.0', '1.2.0+sha.9'),
    ).toBe(true);
  });

  it('fails closed for a malformed candidate version even when ranges are equivalent', () => {
    // Given: an Official published version and malformed candidate version.
    // When: the candidate preserves the same supported Node versions.
    // Then: invalid version metadata cannot bypass the release gate.
    expect(
      narrowsStableNodeEngineRange('1.1.0', '>=20.0.0 <23.0.0', '>=20.0.0 <21.0.0 || >=21.0.0 <23.0.0', 'not-a-semver'),
    ).toBe(true);
  });
});

describe('published Node engine manifest enforcement', () => {
  it.each([
    ['mixed comparator range', '>=20.0.0 <23.0.0', '>=21.0.0 <24.0.0'],
    ['mixed union range', '>=20.0.0 <21.0.0 || >=22.0.0 <23.0.0', '>=21.0.0 <24.0.0'],
  ])('rejects patch metadata when %s removes support while adding support', (_fixture, previousRange, nextRange) => {
    // Given: a published range and candidate range that removes one Node line while adding another.
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'patch', 'Correct a mixed Node engine range fixture.');

    // When: release metadata is checked without a major changeset.
    // Then: any removal from the published support set is rejected.
    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        publishedGraphqlDependencies(nextRange, previousRange),
      ),
    ).toThrow(/stable Node engine range narrowings without a major changeset/u);
  });

  it('rejects patch metadata from the published manifest baseline', () => {
    // Given: the published GraphQL tag permits a broader Node range.
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'patch', 'Correct a release verifier fixture.');

    // When: a candidate removes support without a major changeset.
    // Then: verification rejects it without depending on a PR base ref.
    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        publishedGraphqlDependencies('>=20.19.3 <21 || >=22.2.0 <27'),
      ),
    ).toThrow(/stable Node engine range narrowings without a major changeset/u);
  });

  it.each([
    ['stable build metadata candidate', '1.1.0', '1.1.0+build.7'],
    ['malformed published manifest version', 'published-version-invalid', '1.1.0'],
  ])('fails closed in collector mode for %s', (_fixture, previousVersion, nextVersion) => {
    // Given: a real manifest collector fixture with a narrowed Node range.
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'patch', 'Reduce the supported Node range.');

    // When: the stable release verifier resolves the published manifest tag.
    // Then: Official build metadata stays governed and malformed published versions cannot bypass the gate.
    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        publishedGraphqlDependencies('>=22.0.0 <27', '>=20.16.0 <21 || >=22.0.0 <27', previousVersion, nextVersion),
      ),
    ).toThrow(/stable Node engine range narrowings without a major changeset/u);
  });

  it.each([
    '## Upgrade guidance\n\nNode.js 20 support is removed. Upgrade the package to version 2.0.0.',
    '## Upgrade guidance\n\nUpgrade Node.js when deploying version 2.0.0.',
  ])('rejects weak structured migration guidance %s', (guidance) => {
    // Given: a major Node range removal with unconnected or placeholder upgrade prose.
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'major', `Raise the minimum supported Node.js version.\n\n${guidance}`);

    // When: release metadata is verified.
    // Then: guidance must name the removed Node support and replacement Node version or range.
    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        publishedGraphqlDependencies('>=20.19.3 <21 || >=22.2.0 <27'),
      ),
    ).toThrow(/missing consumer migration notes/u);
  });

  it('requires an explicit migration note with major Node metadata', () => {
    // Given: a published range narrowing and major changeset without migration guidance.
    const directory = createChangesetDirectory();
    writeChangeset(directory, 'major', 'Raise the minimum supported Node.js version.');

    // When: release metadata is verified.
    // Then: the structural migration-note contract is enforced.
    expect(() =>
      verifyChangesetReleaseLane(
        { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
        publishedGraphqlDependencies('>=20.19.3 <21 || >=22.2.0 <27'),
      ),
    ).toThrow(/missing consumer migration notes/u);
  });

  it('accepts major Node metadata with explicit migration guidance', () => {
    // Given: a published range narrowing and major changeset with consumer guidance.
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'major',
      'Raise the minimum supported Node.js version.\n\nMigration: Node.js 20 support is removed. Upgrade to Node.js 22.2.0 before installing this release.',
    );

    // When: release metadata is verified.
    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      publishedGraphqlDependencies('>=20.19.3 <21 || >=22.2.0 <27'),
    );

    // Then: the major metadata and migration note satisfy the contract.
    expect(result.checkedStableNodeEngineRangeNarrowings).toEqual([]);
  });

  it('accepts a structured consumer upgrade guide without a literal Migration marker', () => {
    // Given: a major Node support removal with actionable consumer guidance.
    const directory = createChangesetDirectory();
    writeChangeset(
      directory,
      'major',
      'Raise the minimum supported Node.js version.\n\n## Upgrade guidance\n\nNode.js 20 support is removed. Upgrade production to Node.js 22.2.0 before deploying this release.',
    );

    // When: release metadata is verified.
    const result = verifyChangesetReleaseLane(
      { baseRef: 'origin/main', changesetDirectory: directory, lane: 'stable' },
      publishedGraphqlDependencies('>=20.19.3 <21 || >=22.2.0 <27'),
    );

    // Then: sufficiently structured replacement-runtime guidance satisfies the migration contract.
    expect(result.checkedStableNodeEngineRangeNarrowings).toEqual([]);
  });
});
