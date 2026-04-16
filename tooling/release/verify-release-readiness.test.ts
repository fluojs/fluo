import { describe, expect, it, vi } from 'vitest';
import { runReleaseReadinessVerification } from './verify-release-readiness.mjs';

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
    workspacePackageManifests: vi.fn(() => [
      {
        manifest: {
          name: '@fluojs/cli',
          dependencies: {
            '@fluojs/core': 'workspace:^',
          },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
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
          dependencies: {
            '@fluojs/core': invalidRange,
          },
        },
        packageJsonPath: '/repo/packages/cli/package.json',
      },
      {
        manifest: {
          name: '@fluojs/core',
        },
        packageJsonPath: '/repo/packages/core/package.json',
      },
    ]);

    expect(() => runReleaseReadinessVerification({}, dependencies)).toThrowError(
      'Release readiness check failed: Public internal dependency ranges use workspace:^.',
    );
  });
});
