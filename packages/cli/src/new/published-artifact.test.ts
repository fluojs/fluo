import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BOOTSTRAP_PROFILE, STARTER_PROFILE_REGISTRY } from './starter-profiles.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const releaseVersions: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL('./fixtures/published-release-versions.json', import.meta.url), 'utf8'),
);
const temporaryDirectories: string[] = [];
let artifactDirectory: string;

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('standalone published CLI artifact', () => {
  beforeAll(() => {
    // Given: a release checkout with different 2.x/3.x versions and React still on 0.x.
    const releaseRoot = mkdtempSync(join(tmpdir(), 'fluo-release-input-'));
    artifactDirectory = mkdtempSync(join(tmpdir(), 'fluo-published-artifact-'));
    temporaryDirectories.push(releaseRoot, artifactDirectory);
    const cliRoot = join(releaseRoot, 'packages/cli');
    mkdirSync(cliRoot, { recursive: true });
    for (const entry of ['src', 'scripts', 'bin', 'tsconfig.json', 'tsconfig.build.json']) {
      cpSync(join(repositoryRoot, 'packages/cli', entry), join(cliRoot, entry), { recursive: true });
    }
    for (const entry of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tooling/babel', 'tooling/tsconfig', 'tooling/scripts/clean-dist.mjs']) {
      mkdirSync(join(releaseRoot, entry, '..'), { recursive: true });
      cpSync(join(repositoryRoot, entry), join(releaseRoot, entry), { recursive: true });
    }
    for (const directory of readdirSync(join(repositoryRoot, 'packages'))) {
      const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'packages', directory, 'package.json'), 'utf8'));
      manifest.version = releaseVersions[manifest.name] ?? manifest.version;
      mkdirSync(join(releaseRoot, 'packages', directory), { recursive: true });
      writeFileSync(join(releaseRoot, 'packages', directory, 'package.json'), JSON.stringify(manifest));
    }
    // Build tools and emitted workspace declarations are available only in the release checkout.
    symlinkSync(join(repositoryRoot, 'node_modules'), join(releaseRoot, 'node_modules'), 'dir');
    symlinkSync(join(repositoryRoot, 'packages/cli/node_modules'), join(cliRoot, 'node_modules'), 'dir');

    // Use the actual prebuild/build scripts, then pnpm's published files/manifest packaging.
    execFileSync('pnpm', ['--dir', cliRoot, 'build'], { encoding: 'utf8', timeout: 120_000 });
    execFileSync('pnpm', ['--dir', cliRoot, 'pack', '--pack-destination', artifactDirectory], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const tarball = readdirSync(artifactDirectory).find((name) => name.endsWith('.tgz'));
    if (!tarball) throw new Error('pnpm pack did not produce a CLI tarball.');
    execFileSync('tar', ['-xzf', join(artifactDirectory, tarball), '-C', artifactDirectory], { timeout: 30_000 });
    rmSync(releaseRoot, { force: true, recursive: true });
  }, 180_000);

  it.each([
    { profile: DEFAULT_BOOTSTRAP_PROFILE, label: 'default HTTP', flags: [] },
    ...STARTER_PROFILE_REGISTRY.map((profile) => ({
      profile,
      label: profile.id,
      flags: [
        '--shape', profile.schema.shape,
        '--runtime', profile.schema.runtime,
        '--platform', profile.schema.platform,
        '--transport', profile.schema.transport,
        '--starter', profile.starter,
      ],
    })),
  ])('scaffolds $label using independent release versions without a monorepo', ({ profile, flags }) => {
    // Given: only the unpacked artifact remains, with no source tree or workspace dependencies.
    expect(existsSync(join(artifactDirectory, 'package/src'))).toBe(false);
    expect(existsSync(join(artifactDirectory, 'packages'))).toBe(false);
    expect(existsSync(join(artifactDirectory, 'node_modules'))).toBe(false);
    expect(existsSync(join(artifactDirectory, 'package/node_modules'))).toBe(false);
    const targetDirectory = join(artifactDirectory, flags.length === 0 ? 'default-http' : profile.id);

    // When: the real bin creates a project in ordinary published mode.
    execFileSync(process.execPath, [
      join(artifactDirectory, 'package/bin/fluo.mjs'), 'new', 'release-starter',
      ...flags, '--package-manager', 'pnpm', '--no-install', '--target-directory', targetDirectory,
    ], {
      cwd: artifactDirectory,
      env: { ...process.env, FLUO_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Then: every generated internal range comes from that package's release input, not CLI's.
    const manifest = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8'));
    expect(manifest).not.toHaveProperty('overrides');
    expect(manifest).not.toHaveProperty('resolutions');
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const internalNames = profile.dependencies[section].filter((name) => name.startsWith('@fluojs/'));
      expect(Object.keys(manifest[section]).filter((name) => name.startsWith('@fluojs/')).sort())
        .toEqual([...internalNames].sort());
      for (const name of internalNames) {
        expect(releaseVersions).toHaveProperty(name);
        expect(manifest[section][name], `${profile.id} ${section}.${name}`).toBe(`^${releaseVersions[name]}`);
      }
    }
  });
});
