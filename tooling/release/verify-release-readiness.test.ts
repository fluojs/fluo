import { describe, expect, it, vi } from 'vitest';
import { runReleaseReadinessVerification } from './verify-release-readiness.mjs';

type WorkspacePackageManifestRecord = {
  manifest: Record<string, unknown> & { name: string };
  packageJsonPath: string;
};

function createDependencies() {
  const changelog = `# Changelog

## [Unreleased]

## [1.0.0-beta.2] - 2026-04-25

### @fluojs/cli

- CLI package-specific release note for beta.2.

### @fluojs/studio

- Studio package-specific release note for beta.2.

## [1.0.0-beta.1] - 2026-04-24

### Changed

- Legacy prerelease CLI release note before intent enforcement.

## [0.1.0] - 2026-04-16

### Changed

- Stable CLI release note.

## [0.1.0-beta.1] - 2026-04-15

### Changed

- Prerelease CLI release note.

## [0.0.0]
`;
  const docs = new Map([
    ['docs/getting-started/quick-start.md', 'pnpm add -g @fluojs/cli\nfluo new my-fluo-app\nThe fluo CLI is your central tool for project scaffolding and component generation.'],
    ['CONTRIBUTING.md', 'pnpm sandbox:create\npnpm sandbox:verify\npnpm sandbox:test'],
    [
      'docs/contracts/release-governance.md',
      '## intended publish surface\n- `@fluojs/cli`\n- `@fluojs/core`\n\npnpm verify:release-readiness\npnpm verify:platform-consistency-governance',
    ],
    ['docs/reference/package-surface.md', '## public package families\n| Core | `@fluojs/cli` `@fluojs/core` |'],
    ['docs/reference/toolchain-contract-matrix.md', '## generated app baseline\n## CLI & scaffolding contracts\n## naming conventions (CLI output)\nfluo new\nfluo inspect'],
    ['packages/cli/README.md', 'canonical CLI'],
    [
      'packages/cli/src/new/scaffold.ts',
      "const RuntimeHealthModule = createHealthModule();\n@Controller('/health-info')\nconst app = await FluoFactory.create(AppModule, {\nadapter: createFastifyAdapter({ port })\nawait app.listen();\ncreateHealthModule\ncreateFastifyAdapter",
    ],
    ['packages/cli/package.json', JSON.stringify({ bin: { fluo: './bin/fluo.mjs' }, main: './dist/index.js' })],
    ['CHANGELOG.md', changelog],
  ]);

  return {
    isReleaseTagExisting: vi.fn(() => false),
    isPublishedVersion: vi.fn(() => false),
    run: vi.fn(),
    read: vi.fn((relativePath) => {
      const value = docs.get(relativePath);
      if (typeof value !== 'string') {
        throw new Error(`Unexpected read: ${relativePath}`);
      }

      return value;
    }),
    existsSync: vi.fn((targetPath) => targetPath.endsWith('/LICENSE') || targetPath.endsWith('/CHANGELOG.md')),
    workspacePackageNames: vi.fn(() => ['@fluojs/cli', '@fluojs/core']),
    workspacePackageManifests: vi.fn<() => WorkspacePackageManifestRecord[]>(() => [
      {
        manifest: {
          name: '@fluojs/cli',
          private: false,
          publishConfig: { access: 'public' },
          dependencies: {
            '@fluojs/core': 'workspace:^',
          },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/core/package.json',
      },
    ]),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => changelog),
    writeFileSync: vi.fn(),
  };
}

function createReleaseIntentRecord(
  version: string,
  packages: Array<{
    disposition: 'release' | 'no-release' | 'downstream-evaluate';
    package: string;
    semver?: 'patch' | 'minor' | 'major' | 'none';
  }>,
) {
  return {
    version,
    packages: packages.map((packageIntent) => ({
      disposition: packageIntent.disposition,
      package: packageIntent.package,
      rationale: `${packageIntent.package} ${packageIntent.disposition} rationale`,
      semver: packageIntent.semver ?? (packageIntent.disposition === 'release' ? 'patch' : 'none'),
      summary: `${packageIntent.package} ${packageIntent.disposition} summary`,
    })),
  };
}

function createCliReleaseIntentRecord(version = '1.0.0-beta.2') {
  return createReleaseIntentRecord(version, [{ disposition: 'release', package: '@fluojs/cli' }]);
}

function modelCoreWithCliAndStudioDownstreams(dependencies: ReturnType<typeof createDependencies>) {
  const baseRead = dependencies.read;

  dependencies.read = vi.fn((relativePath) => {
    if (relativePath === 'docs/contracts/release-governance.md') {
      return '## intended publish surface\n- `@fluojs/cli`\n- `@fluojs/core`\n- `@fluojs/studio`\n\npnpm verify:release-readiness\npnpm verify:platform-consistency-governance';
    }

    if (relativePath === 'docs/reference/package-surface.md') {
      return '## public package families\n| Core | `@fluojs/cli` `@fluojs/core` `@fluojs/studio` |';
    }

    return baseRead(relativePath);
  });
  dependencies.workspacePackageNames = vi.fn(() => ['@fluojs/cli', '@fluojs/core', '@fluojs/studio']);
  dependencies.workspacePackageManifests = vi.fn<() => WorkspacePackageManifestRecord[]>(() => [
    {
      manifest: {
        name: '@fluojs/cli',
        private: false,
        publishConfig: { access: 'public' },
        dependencies: {
          '@fluojs/core': 'workspace:^',
        },
      },
      packageJsonPath: '/repo/packages/cli/package.json',
    },
    {
      manifest: {
        name: '@fluojs/core',
        private: false,
        publishConfig: { access: 'public' },
      },
      packageJsonPath: '/repo/packages/core/package.json',
    },
    {
      manifest: {
        name: '@fluojs/studio',
        private: false,
        publishConfig: { access: 'public' },
        dependencies: {
          '@fluojs/core': 'workspace:^',
        },
      },
      packageJsonPath: '/repo/packages/studio/package.json',
    },
  ]);
  (dependencies as ReturnType<typeof createDependencies> & { hasReleaseNotesForPackage: ReturnType<typeof vi.fn> }).hasReleaseNotesForPackage = vi.fn(() => true);
}

describe('runReleaseReadinessVerification', () => {
  it('keeps default verification read-only', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification({}, dependencies);

    expect(result.writeDrafts).toBe(false);
    expect(dependencies.run).toHaveBeenCalledTimes(7);
    expect(dependencies.run.mock.calls).toEqual([
      ['pnpm', ['build']],
      ['pnpm', ['typecheck']],
      ['pnpm', ['vitest', 'run', '--project', 'packages']],
      ['pnpm', ['vitest', 'run', '--project', 'apps']],
      ['pnpm', ['vitest', 'run', '--project', 'examples']],
      ['pnpm', ['vitest', 'run', '--project', 'tooling']],
      ['pnpm', ['--dir', 'packages/cli', 'sandbox:matrix']],
    ]);
    expect(dependencies.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes draft artifacts only when explicitly requested', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification({ writeDrafts: true }, dependencies);

    expect(result.writeDrafts).toBe(true);
    expect(dependencies.writeFileSync).toHaveBeenCalledTimes(3);
    expect(dependencies.writeFileSync.mock.calls.some(([targetPath]) => String(targetPath).endsWith('/CHANGELOG.md'))).toBe(true);
    expect(
      dependencies.writeFileSync.mock.calls.some(([, content]) =>
        String(content).includes('use `pnpm generate:release-readiness-drafts`') ||
        String(content).includes('`CHANGELOG.md`, `tooling/release/release-readiness-summary.md`'),
      ),
    ).toBe(true);
  });

  it('can write current-run summaries without mutating changelog drafts', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification(
      {
        summaryOutputDirectory: '/tmp/release-readiness',
        writeSummary: true,
      },
      dependencies,
    );

    expect(result.writeDrafts).toBe(false);
    expect(result.writeSummary).toBe(true);
    expect(dependencies.writeFileSync).toHaveBeenCalledTimes(2);
    expect(dependencies.writeFileSync.mock.calls.every(([targetPath]) => !String(targetPath).endsWith('/CHANGELOG.md'))).toBe(true);
    expect(dependencies.writeFileSync.mock.calls.some(([targetPath]) => String(targetPath).includes('/tmp/release-readiness/release-readiness-summary.md'))).toBe(true);
    expect(
      dependencies.writeFileSync.mock.calls.some(([, content]) =>
        String(content).includes('current-run release-readiness summary artifacts generated without mutating `CHANGELOG.md`.'),
      ),
    ).toBe(true);
  });

  it('describes split workspace vitest projects in release-readiness summaries', () => {
    const dependencies = createDependencies();

    runReleaseReadinessVerification(
      {
        summaryOutputDirectory: '/tmp/release-readiness',
        writeSummary: true,
      },
      dependencies,
    );

    const summaryContents = dependencies.writeFileSync.mock.calls.map(([, content]) => String(content)).join('\n');

    expect(summaryContents).toContain('`pnpm vitest run --project packages`');
    expect(summaryContents).toContain('`pnpm vitest run --project apps`');
    expect(summaryContents).toContain('`pnpm vitest run --project examples`');
    expect(summaryContents).toContain('`pnpm vitest run --project tooling`');
    expect(summaryContents).not.toContain('`pnpm test`');
  });

  it.each(['workspace:*', 'workspace:~', 'workspace:^1.2.3'])('fails when a documented public package uses %s instead of workspace:^', (invalidRange) => {
    const dependencies = createDependencies();
    dependencies.workspacePackageManifests = vi.fn(() => [
      {
        manifest: {
          name: '@fluojs/cli',
          private: false,
          publishConfig: { access: 'public' },
          dependencies: {
            '@fluojs/core': invalidRange,
          },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/core/package.json',
      },
    ]);

    expect(() => runReleaseReadinessVerification({}, dependencies)).toThrowError(
      'Release readiness check failed: Public internal dependency ranges use workspace:^.',
    );
  });

  it('accepts single-package publish preflight for a public prerelease target', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification(
      {
        distTag: 'next',
        targetPackage: '@fluojs/cli',
        targetVersion: '0.1.0-beta.1',
      },
      dependencies,
    );

    expect(result.checks.some((check) => check.label === 'Single-package release internal dependency shape')).toBe(true);
    expect(result.checks.some((check) => check.label === 'Single-package release package notes')).toBe(true);
    expect(result.checks.some((check) => check.label === 'Single-package release target git tag absence')).toBe(true);
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith('@fluojs/cli@0.1.0-beta.1');
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '0.1.0-beta.1');
  });

  it('does not require release intents for explicit changed packages before the intent cutoff', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification(
      {
        changedPackages: ['@fluojs/cli'],
        distTag: 'next',
        targetPackage: '@fluojs/cli',
        targetVersion: '1.0.0-beta.1',
      },
      dependencies,
    );

    expect(result.checks.some((check) => check.label.startsWith('Release intent'))).toBe(false);
    expect(result.checks.some((check) => check.label === 'Single-package release package notes')).toBe(true);
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith('@fluojs/cli@1.0.0-beta.1');
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '1.0.0-beta.1');
  });

  it('accepts single-package publish preflight for valid package-specific notes after the package-note cutoff', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification(
      {
        distTag: 'beta',
        releaseIntentRecords: [createCliReleaseIntentRecord()],
        targetPackage: '@fluojs/cli',
        targetVersion: '1.0.0-beta.2',
      },
      dependencies,
    );

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Single-package release package notes',
          pass: true,
        }),
        expect.objectContaining({
          label: 'Single-package release target git tag absence',
          pass: true,
        }),
      ]),
    );
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith('@fluojs/cli@1.0.0-beta.2');
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '1.0.0-beta.2');
  });

  it('accepts a file-based single release intent record matching the committed schema example', () => {
    const dependencies = createDependencies();
    dependencies.readFileSync = vi.fn((targetPath: string) => {
      if (String(targetPath).endsWith('/tooling/release/intents/cli-beta.2.json')) {
        return JSON.stringify(createCliReleaseIntentRecord());
      }

      throw new Error(`Unexpected file read: ${targetPath}`);
    });

    const result = runReleaseReadinessVerification(
      {
        distTag: 'beta',
        releaseIntentFile: 'tooling/release/intents/cli-beta.2.json',
        targetPackage: '@fluojs/cli',
        targetVersion: '1.0.0-beta.2',
      },
      dependencies,
    );

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Release intent coverage for affected packages', pass: true }),
        expect.objectContaining({ label: 'Single-package release target intent disposition', pass: true }),
      ]),
    );
    expect(dependencies.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('/tooling/release/intents/cli-beta.2.json'),
      'utf8',
    );
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '1.0.0-beta.2');
  });

  it('fails when a changed public package has no release intent after the cutoff', () => {
    const dependencies = createDependencies();

    expect(() =>
      runReleaseReadinessVerification(
        {
          changedPackages: ['@fluojs/cli'],
          distTag: 'beta',
          releaseIntentRecords: [
            createReleaseIntentRecord('1.0.0-beta.2', [{ disposition: 'no-release', package: '@fluojs/core', semver: 'none' }]),
          ],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Missing release intent or evaluation decision for affected package\(s\): @fluojs\/cli/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails when release intent records reference unknown public packages', () => {
    const dependencies = createDependencies();

    expect(() =>
      runReleaseReadinessVerification(
        {
          changedPackages: ['@fluojs/cli'],
          distTag: 'beta',
          releaseIntentRecords: [
            createReleaseIntentRecord('1.0.0-beta.2', [
              { disposition: 'release', package: '@fluojs/cli' },
              { disposition: 'no-release', package: '@fluojs/unknown', semver: 'none' },
            ]),
          ],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/references unknown public workspace package @fluojs\/unknown/u);
  });

  it('fails when downstream impacted packages have no evaluation decision', () => {
    const dependencies = createDependencies();
    modelCoreWithCliAndStudioDownstreams(dependencies);

    expect(() =>
      runReleaseReadinessVerification(
        {
          changedPackages: ['@fluojs/core'],
          distTag: 'beta',
          releaseIntentRecords: [
            createReleaseIntentRecord('1.0.0-beta.2', [{ disposition: 'release', package: '@fluojs/core' }]),
          ],
          targetPackage: '@fluojs/core',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Missing release intent or evaluation decision.*@fluojs\/cli, @fluojs\/studio/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('passes with a target release intent and downstream no-release or evaluation decisions', () => {
    const dependencies = createDependencies();
    modelCoreWithCliAndStudioDownstreams(dependencies);

    const result = runReleaseReadinessVerification(
      {
        changedPackages: ['@fluojs/core'],
        distTag: 'beta',
        releaseIntentRecords: [
          createReleaseIntentRecord('1.0.0-beta.2', [
            { disposition: 'release', package: '@fluojs/core' },
            { disposition: 'no-release', package: '@fluojs/cli', semver: 'none' },
            { disposition: 'downstream-evaluate', package: '@fluojs/studio', semver: 'none' },
          ]),
        ],
        targetPackage: '@fluojs/core',
        targetVersion: '1.0.0-beta.2',
      },
      dependencies,
    );

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Release intent coverage for affected packages', pass: true }),
        expect.objectContaining({ label: 'Release intent downstream evaluation decisions', pass: true }),
        expect.objectContaining({ label: 'Single-package release target intent disposition', pass: true }),
      ]),
    );
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith('@fluojs/core@1.0.0-beta.2');
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/core', '1.0.0-beta.2');
  });

  it('fails when a single-package prerelease tries to use the latest dist-tag', () => {
    const dependencies = createDependencies();

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'latest',
          targetPackage: '@fluojs/cli',
          targetVersion: '0.1.0-beta.1',
        },
        dependencies,
      ),
    ).toThrowError('Release readiness check failed: Single-package release prerelease alignment.');
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('keeps stable releases aligned to the latest dist-tag', () => {
    const dependencies = createDependencies();

    runReleaseReadinessVerification(
      {
        distTag: 'latest',
        targetPackage: '@fluojs/cli',
        targetVersion: '0.1.0',
      },
      dependencies,
    );

    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '0.1.0');
  });

  it('fails when a stable single-package release uses a non-latest dist-tag', () => {
    const dependencies = createDependencies();

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'beta',
          targetPackage: '@fluojs/cli',
          targetVersion: '0.1.0',
        },
        dependencies,
      ),
    ).toThrowError('Release readiness check failed: Single-package release prerelease alignment.');
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails before publish when package-specific notes are missing for the target package and version', () => {
    const dependencies = createDependencies();
    dependencies.read = vi.fn((relativePath) => {
      if (relativePath === 'CHANGELOG.md') {
        return `# Changelog

## [Unreleased]

## [1.0.0-beta.2] - 2026-04-25

### @fluojs/studio

- Studio package-specific release note for beta.2.

## [0.0.0]
`;
      }

      return createDependencies().read(relativePath);
    });

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'beta',
          releaseIntentRecords: [createCliReleaseIntentRecord()],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Missing package release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails before publish when post-cutoff package notes are ambiguous generic notes', () => {
    const dependencies = createDependencies();
    dependencies.read = vi.fn((relativePath) => {
      if (relativePath === 'CHANGELOG.md') {
        return `# Changelog

## [Unreleased]

## [1.0.0-beta.2] - 2026-04-25

### Changed

- Generic beta.2 note without a package subsection.

## [0.0.0]
`;
      }

      return createDependencies().read(relativePath);
    });

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'beta',
          releaseIntentRecords: [createCliReleaseIntentRecord()],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Ambiguous generic release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails before publish when duplicate package notes exist for the target package and version', () => {
    const dependencies = createDependencies();
    dependencies.read = vi.fn((relativePath) => {
      if (relativePath === 'CHANGELOG.md') {
        return `# Changelog

## [Unreleased]

## [1.0.0-beta.2] - 2026-04-25

### @fluojs/cli

- First CLI note.

### @fluojs/cli

- Duplicate CLI note.

## [0.0.0]
`;
      }

      return createDependencies().read(relativePath);
    });

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'beta',
          releaseIntentRecords: [createCliReleaseIntentRecord()],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Duplicate package release notes.*@fluojs\/cli.*1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).not.toHaveBeenCalled();
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails before publish when the target release tag already exists', () => {
    const dependencies = createDependencies();
    dependencies.isReleaseTagExisting = vi.fn(() => true);

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'beta',
          releaseIntentRecords: [createCliReleaseIntentRecord()],
          targetPackage: '@fluojs/cli',
          targetVersion: '1.0.0-beta.2',
        },
        dependencies,
      ),
    ).toThrowError(/Release readiness check failed: Single-package release target git tag absence.*@fluojs\/cli@1\.0\.0-beta\.2/u);
    expect(dependencies.isReleaseTagExisting).toHaveBeenCalledWith('@fluojs/cli@1.0.0-beta.2');
    expect(dependencies.isPublishedVersion).not.toHaveBeenCalled();
  });

  it('fails when the single-package target is outside the intended publish surface', () => {
    const dependencies = createDependencies();
    dependencies.workspacePackageNames = vi.fn(() => ['@fluojs/cli', '@fluojs/core', '@fluojs/private-devtool']);
    dependencies.workspacePackageManifests = vi.fn(() => [
      {
        manifest: {
          name: '@fluojs/cli',
          dependencies: {
            '@fluojs/core': 'workspace:^',
          },
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/core/package.json',
      },
      {
        manifest: {
          name: '@fluojs/private-devtool',
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/private-devtool/package.json',
      },
    ]);

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'latest',
          targetPackage: '@fluojs/private-devtool',
          targetVersion: '0.1.0',
        },
        dependencies,
      ),
    ).toThrowError('Release readiness check failed: Single-package release intended publish surface membership.');
  });

  it('fails when a single-package target depends on a non-public internal workspace package', () => {
    const dependencies = createDependencies();
    dependencies.workspacePackageNames = vi.fn(() => ['@fluojs/cli', '@fluojs/core', '@fluojs/private-devtool']);
    dependencies.workspacePackageManifests = vi.fn(() => [
      {
        manifest: {
          name: '@fluojs/cli',
          dependencies: {
            '@fluojs/core': 'workspace:^',
            '@fluojs/private-devtool': 'workspace:^',
          },
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
          private: false,
          publishConfig: { access: 'public' },
        },
        packageJsonPath: '/repo/packages/core/package.json',
      },
      {
        manifest: {
          name: '@fluojs/private-devtool',
          private: true,
        },
        packageJsonPath: '/repo/packages/private-devtool/package.json',
      },
    ]);

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'latest',
          targetPackage: '@fluojs/cli',
          targetVersion: '0.1.0',
        },
        dependencies,
      ),
    ).toThrowError('Release readiness check failed: Single-package release internal dependency shape.');
  });

  it('fails when the target version is already published', () => {
    const dependencies = createDependencies();
    dependencies.isPublishedVersion = vi.fn(() => true);

    expect(() =>
      runReleaseReadinessVerification(
        {
          distTag: 'latest',
          targetPackage: '@fluojs/cli',
          targetVersion: '0.1.0',
        },
        dependencies,
      ),
    ).toThrowError('Release readiness check failed: Single-package release version publishability.');
  });
});
