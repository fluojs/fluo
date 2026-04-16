import { describe, expect, it, vi } from 'vitest';
import { runReleaseReadinessVerification } from './verify-release-readiness.mjs';

type WorkspacePackageManifestRecord = {
  manifest: Record<string, unknown> & { name: string };
  packageJsonPath: string;
};

function createDependencies() {
  const docs = new Map([
    ['docs/getting-started/quick-start.md', 'pnpm add -g @fluojs/cli\nfluo new my-fluo-app\nThe fluo CLI is your central tool for project scaffolding and component generation.'],
    ['CONTRIBUTING.md', 'pnpm sandbox:create\npnpm sandbox:verify\npnpm sandbox:test'],
    [
      'docs/operations/release-governance.md',
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
    ['CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n\n## [0.0.0]\n'],
  ]);

  return {
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
    readFileSync: vi.fn(() => '# Changelog\n\n## [Unreleased]\n'),
    writeFileSync: vi.fn(),
  };
}

describe('runReleaseReadinessVerification', () => {
  it('keeps default verification read-only', () => {
    const dependencies = createDependencies();

    const result = runReleaseReadinessVerification({}, dependencies);

    expect(result.writeDrafts).toBe(false);
    expect(dependencies.run).toHaveBeenCalledTimes(4);
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
    expect(dependencies.isPublishedVersion).toHaveBeenCalledWith('@fluojs/cli', '0.1.0-beta.1');
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
