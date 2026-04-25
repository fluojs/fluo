import { describe, expect, it, vi } from 'vitest';
import { buildGitHubReleaseNotes } from './prepare-github-release.mjs';
import { runReleaseReadinessVerification } from './verify-release-readiness.mjs';

type ReleaseDisposition = 'release' | 'no-release' | 'downstream-evaluate';
type SemverIntent = 'patch' | 'minor' | 'major' | 'none';
type WorkspacePackageManifestRecord = {
  manifest: Record<string, unknown> & { name: string };
  packageJsonPath: string;
};

const betaVersion = '1.0.0-beta.2';
const stableVersion = '1.0.0';

const packageScopedChangelog = `# Changelog

## [Unreleased]

## [${stableVersion}] - 2026-04-26

### @fluojs/cli

- CLI stable release note.

## [${betaVersion}] - 2026-04-25

### @fluojs/cli

- CLI package-specific release note for beta.2.

### @fluojs/studio

- Studio package-specific release note for beta.2.

### @fluojs/runtime

- Runtime package-specific release note for beta.2.

## [0.0.0]
`;

function packageManifest(
  name: string,
  options: {
    dependencies?: Record<string, string>;
    private?: boolean;
    publishAccess?: string;
  } = {},
): WorkspacePackageManifestRecord {
  return {
    manifest: {
      name,
      private: options.private ?? false,
      publishConfig: { access: options.publishAccess ?? 'public' },
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    },
    packageJsonPath: `/repo/packages/${name.slice('@fluojs/'.length)}/package.json`,
  };
}

function createReleaseIntentRecord(
  version: string,
  packages: Array<{
    disposition: ReleaseDisposition;
    package: string;
    semver?: SemverIntent;
  }>,
) {
  return {
    version,
    packages: packages.map((packageIntent) => ({
      disposition: packageIntent.disposition,
      package: packageIntent.package,
      rationale: `${packageIntent.package} ${packageIntent.disposition} dry-run rationale`,
      semver: packageIntent.semver ?? (packageIntent.disposition === 'release' ? 'patch' : 'none'),
      summary: `${packageIntent.package} ${packageIntent.disposition} dry-run summary`,
    })),
  };
}

function docsFor(publicPackageNames: string[], changelog = packageScopedChangelog) {
  const packageList = publicPackageNames.map((packageName) => `- \`${packageName}\``).join('\n');
  const packageSurface = publicPackageNames.map((packageName) => `\`${packageName}\``).join(' ');

  return new Map([
    [
      'docs/getting-started/quick-start.md',
      'pnpm add -g @fluojs/cli\nfluo new my-fluo-app\nThe fluo CLI is your central tool for project scaffolding and component generation.',
    ],
    ['CONTRIBUTING.md', 'pnpm sandbox:create\npnpm sandbox:verify\npnpm sandbox:test'],
    [
      'docs/contracts/release-governance.md',
      `## intended publish surface\n${packageList}\n\npnpm verify:release-readiness\npnpm verify:platform-consistency-governance`,
    ],
    ['docs/reference/package-surface.md', `## public package families\n| Runtime | ${packageSurface} |`],
    [
      'docs/reference/toolchain-contract-matrix.md',
      '## generated app baseline\n## CLI & scaffolding contracts\n## naming conventions (CLI output)\nfluo new\nfluo inspect',
    ],
    ['packages/cli/README.md', 'canonical CLI'],
    [
      'packages/cli/src/new/scaffold.ts',
      "const RuntimeHealthModule = createHealthModule();\n@Controller('/health-info')\nconst app = await FluoFactory.create(AppModule, {\nadapter: createFastifyAdapter({ port })\nawait app.listen();\ncreateHealthModule\ncreateFastifyAdapter",
    ],
    ['packages/cli/package.json', JSON.stringify({ bin: { fluo: './bin/fluo.mjs' }, main: './dist/index.js' })],
    ['CHANGELOG.md', changelog],
  ]);
}

function createDryRunDependencies(
  options: {
    changelog?: string;
    manifests?: WorkspacePackageManifestRecord[];
    publicPackageNames?: string[];
    releaseTagExists?: (tag: string) => boolean;
    versionPublished?: (packageName: string, version: string) => boolean;
    workspacePackageNames?: string[];
  } = {},
) {
  const publicPackageNames = options.publicPackageNames ?? ['@fluojs/cli', '@fluojs/runtime', '@fluojs/studio'];
  const manifests = options.manifests ?? [
    packageManifest('@fluojs/cli', { dependencies: { '@fluojs/runtime': 'workspace:^' } }),
    packageManifest('@fluojs/runtime'),
    packageManifest('@fluojs/studio', { dependencies: { '@fluojs/runtime': 'workspace:^' } }),
  ];
  const docs = docsFor(publicPackageNames, options.changelog);

  return {
    existsSync: vi.fn((targetPath: string) => targetPath.endsWith('/LICENSE') || targetPath.endsWith('/CHANGELOG.md')),
    isPublishedVersion: vi.fn(options.versionPublished ?? (() => false)),
    isReleaseTagExisting: vi.fn(options.releaseTagExists ?? (() => false)),
    read: vi.fn((relativePath: string) => {
      const value = docs.get(relativePath);
      if (typeof value !== 'string') {
        throw new Error(`Unexpected dry-run read: ${relativePath}`);
      }

      return value;
    }),
    run: vi.fn(),
    workspacePackageManifests: vi.fn(() => manifests),
    workspacePackageNames: vi.fn(() => options.workspacePackageNames ?? publicPackageNames),
  };
}

function runDryRunMatrixCase(
  targetPackage: string,
  options: {
    changedPackages?: string[];
    dependencies?: ReturnType<typeof createDryRunDependencies>;
    distTag?: string;
    releaseIntentRecords?: ReturnType<typeof createReleaseIntentRecord>[];
    targetVersion?: string;
  } = {},
) {
  return runReleaseReadinessVerification(
    {
      changedPackages: options.changedPackages,
      distTag: options.distTag ?? 'beta',
      releaseIntentRecords:
        options.releaseIntentRecords ??
        [createReleaseIntentRecord(options.targetVersion ?? betaVersion, [{ disposition: 'release', package: targetPackage }])],
      targetPackage,
      targetVersion: options.targetVersion ?? betaVersion,
    },
    options.dependencies ?? createDryRunDependencies(),
  );
}

function expectWorkflowPreflightWasLocal(dependencies: ReturnType<typeof createDryRunDependencies>) {
  expect(dependencies.run.mock.calls).toEqual([
    ['pnpm', ['build']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['vitest', 'run', '--project', 'packages']],
    ['pnpm', ['vitest', 'run', '--project', 'apps']],
    ['pnpm', ['vitest', 'run', '--project', 'examples']],
    ['pnpm', ['vitest', 'run', '--project', 'tooling']],
    ['pnpm', ['--dir', 'packages/cli', 'sandbox:matrix']],
  ]);
}

describe('local release dry-run matrix', () => {
  it('keeps same-version CLI and Studio package-specific notes isolated while passing readiness', () => {
    const dependencies = createDryRunDependencies();
    const cliNotes = buildGitHubReleaseNotes(`@fluojs/cli@${betaVersion}`, packageScopedChangelog);
    const studioNotes = buildGitHubReleaseNotes(`@fluojs/studio@${betaVersion}`, packageScopedChangelog);

    const cliResult = runDryRunMatrixCase('@fluojs/cli', { dependencies });
    const studioResult = runDryRunMatrixCase('@fluojs/studio', { dependencies: createDryRunDependencies() });

    expect(cliNotes).toContain('- CLI package-specific release note for beta.2.');
    expect(cliNotes).not.toContain('- Studio package-specific release note for beta.2.');
    expect(studioNotes).toContain('- Studio package-specific release note for beta.2.');
    expect(studioNotes).not.toContain('- CLI package-specific release note for beta.2.');
    expect(cliResult.checks).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Single-package release package notes', pass: true })]));
    expect(studioResult.checks).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Single-package release package notes', pass: true })]));
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', betaVersion);
    expectWorkflowPreflightWasLocal(dependencies);
  });

  it('rejects missing package notes before tag and publishability checks', () => {
    const dependencies = createDryRunDependencies({
      changelog: `# Changelog

## [Unreleased]

## [${betaVersion}] - 2026-04-25

### @fluojs/studio

- Studio package-specific release note for beta.2.

## [0.0.0]
`,
    });

    expect(() => runDryRunMatrixCase('@fluojs/cli', { dependencies })).toThrowError(/Missing package release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('rejects ambiguous generic package notes before tag and publishability checks', () => {
    const dependencies = createDryRunDependencies({
      changelog: `# Changelog

## [Unreleased]

## [${betaVersion}] - 2026-04-25

### Changed

- Generic beta.2 note without a package subsection.

## [0.0.0]
`,
    });

    expect(() => runDryRunMatrixCase('@fluojs/cli', { dependencies })).toThrowError(/Ambiguous generic release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('rejects an existing target tag before publishability checks', () => {
    const dependencies = createDryRunDependencies({ releaseTagExists: (tag) => tag === `@fluojs/cli@${betaVersion}` });

    expect(() => runDryRunMatrixCase('@fluojs/cli', { dependencies })).toThrowError(/Single-package release target git tag absence.*@fluojs\/cli@1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith(`@fluojs/cli@${betaVersion}`);
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('passes runtime release only with explicit CLI and Studio downstream decisions and no downstream publish', () => {
    const dependencies = createDryRunDependencies();
    const result = runDryRunMatrixCase('@fluojs/runtime', {
      changedPackages: ['@fluojs/runtime'],
      dependencies,
      releaseIntentRecords: [
        createReleaseIntentRecord(betaVersion, [
          { disposition: 'release', package: '@fluojs/runtime' },
          { disposition: 'downstream-evaluate', package: '@fluojs/cli', semver: 'none' },
          { disposition: 'no-release', package: '@fluojs/studio', semver: 'none' },
        ]),
      ],
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Release intent coverage for affected packages', pass: true }),
        expect.objectContaining({ label: 'Release intent downstream evaluation decisions', pass: true }),
        expect.objectContaining({ label: 'Single-package release target intent disposition', pass: true }),
      ]),
    );
    expect(dependencies.isPublishedVersion.mock.calls).toEqual([['@fluojs/runtime', betaVersion]]);
    expect(dependencies.isReleaseTagExisting.mock.calls).toEqual([[`@fluojs/runtime@${betaVersion}`]]);
  });

  it('rejects runtime changes when CLI and Studio downstream decisions are missing', () => {
    const dependencies = createDryRunDependencies();

    expect(() =>
      runDryRunMatrixCase('@fluojs/runtime', {
        changedPackages: ['@fluojs/runtime'],
        dependencies,
        releaseIntentRecords: [createReleaseIntentRecord(betaVersion, [{ disposition: 'release', package: '@fluojs/runtime' }])],
      }),
    ).toThrowError(/Missing release intent or evaluation decision.*@fluojs\/cli, @fluojs\/studio/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('rejects private or unknown single-package targets before publishability checks', () => {
    const privateDependencies = createDryRunDependencies({
      manifests: [
        packageManifest('@fluojs/cli', { dependencies: { '@fluojs/runtime': 'workspace:^' } }),
        packageManifest('@fluojs/runtime'),
        packageManifest('@fluojs/private-devtool', { private: true }),
      ],
      publicPackageNames: ['@fluojs/cli', '@fluojs/runtime'],
      workspacePackageNames: ['@fluojs/cli', '@fluojs/runtime', '@fluojs/private-devtool'],
    });
    const unknownDependencies = createDryRunDependencies();

    expect(() =>
      runDryRunMatrixCase('@fluojs/private-devtool', {
        dependencies: privateDependencies,
        distTag: 'latest',
        releaseIntentRecords: undefined,
        targetVersion: stableVersion,
      }),
    ).toThrowError(/Release intent validation failed: packages\[0\]\.package references unknown public workspace package @fluojs\/private-devtool/u);
    expect(privateDependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(privateDependencies.isPublishedVersion).not.toHaveBeenCalled();

    expect(() =>
      runDryRunMatrixCase('@fluojs/unknown', {
        dependencies: unknownDependencies,
        distTag: 'latest',
        releaseIntentRecords: undefined,
        targetVersion: stableVersion,
      }),
    ).toThrowError(/Release intent validation failed: packages\[0\]\.package references unknown public workspace package @fluojs\/unknown/u);
    expect(unknownDependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(unknownDependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('enforces prerelease/beta and stable/latest dist-tag alignment', () => {
    const betaDependencies = createDryRunDependencies();
    const latestDependencies = createDryRunDependencies();
    const invalidPrereleaseDependencies = createDryRunDependencies();
    const invalidStableDependencies = createDryRunDependencies();

    runDryRunMatrixCase('@fluojs/cli', { dependencies: betaDependencies, distTag: 'beta' });
    runDryRunMatrixCase('@fluojs/cli', {
      dependencies: latestDependencies,
      distTag: 'latest',
      releaseIntentRecords: [createReleaseIntentRecord(stableVersion, [{ disposition: 'release', package: '@fluojs/cli' }])],
      targetVersion: stableVersion,
    });

    expect(() => runDryRunMatrixCase('@fluojs/cli', { dependencies: invalidPrereleaseDependencies, distTag: 'latest' })).toThrowError(
      'Release readiness check failed: Single-package release prerelease alignment.',
    );
    expect(() =>
      runDryRunMatrixCase('@fluojs/cli', {
        dependencies: invalidStableDependencies,
        distTag: 'beta',
        releaseIntentRecords: [createReleaseIntentRecord(stableVersion, [{ disposition: 'release', package: '@fluojs/cli' }])],
        targetVersion: stableVersion,
      }),
    ).toThrowError('Release readiness check failed: Single-package release prerelease alignment.');
    expect(betaDependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', betaVersion);
    expect(latestDependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', stableVersion);
    expect(invalidPrereleaseDependencies.isPublishedVersion).not.toHaveBeenCalled();
    expect(invalidStableDependencies.isPublishedVersion).not.toHaveBeenCalled();
  });
});
