import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionPackages } from './version-packages.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const releaseVersions: Readonly<Record<string, string>> = JSON.parse(readFileSync(
  join(repositoryRoot, 'packages/cli/src/new/fixtures/published-release-versions.json'), 'utf8',
));
const temporaryDirectories: string[] = [];
const generatedRelativePath = 'packages/cli/src/new/published-internal-dependencies.ts';

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createReleaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'fluo-cli-release-metadata-'));
  temporaryDirectories.push(root);
  const script = 'packages/cli/scripts/generate-published-internal-dependencies.mjs';
  for (const path of [script, 'packages/cli/src/new/starter-profiles.ts', generatedRelativePath]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repositoryRoot, path), join(root, path));
  }
  for (const [name, version] of Object.entries(releaseVersions)) {
    const packagePath = join(root, 'packages', name.slice('@fluojs/'.length));
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(join(packagePath, 'package.json'), JSON.stringify({ name, version, type: 'module' }));
  }
  return { root, script: join(root, script), output: join(root, generatedRelativePath) };
}

describe('CLI release metadata generation', () => {
  it('refreshes metadata from manifests changed during versioning', () => {
    const fixture = createReleaseFixture();
    execFileSync(process.execPath, [fixture.script], { timeout: 10_000 });
    const nextVersions = { ...releaseVersions, '@fluojs/config': '9.8.7', '@fluojs/react': '0.12.3' };

    runVersionPackages({
      workspacePackageManifests: () => [],
      runChangesetsVersion: () => {
        for (const [name, version] of Object.entries(nextVersions)) {
          writeFileSync(
            join(fixture.root, 'packages', name.slice('@fluojs/'.length), 'package.json'),
            JSON.stringify({ name, version, type: 'module' }),
          );
        }
      },
      execFileSync: (command, args) => {
        expect(command).toBe(process.execPath);
        expect(args).toEqual([join(repositoryRoot, 'packages/cli/scripts/generate-published-internal-dependencies.mjs')]);
        // Execute only the copied generator: its import.meta.url confines all writes to the fixture.
        execFileSync(process.execPath, [fixture.script], { timeout: 10_000 });
      },
    });

    const output = execFileSync(process.execPath, [
      '--input-type=module', '--eval',
      `import { PUBLISHED_INTERNAL_DEPENDENCIES } from ${JSON.stringify(pathToFileURL(fixture.output).href)}; console.log(JSON.stringify(PUBLISHED_INTERNAL_DEPENDENCIES));`,
    ], { encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(output)).toEqual(Object.fromEntries(
      Object.entries(nextVersions).filter(([name]) => name !== '@fluojs/cli')
        .map(([name, version]) => [name, `^${version}`]),
    ));
  });

  it('propagates generator failure after versioning without replacing metadata', () => {
    const fixture = createReleaseFixture();
    const previousOutput = readFileSync(fixture.output, 'utf8');

    expect(() => runVersionPackages({
      workspacePackageManifests: () => [],
      runChangesetsVersion: () => {
        writeFileSync(join(fixture.root, 'packages/config/package.json'), JSON.stringify({
          name: '@fluojs/config', version: '',
        }));
      },
      execFileSync: () => {
        execFileSync(process.execPath, [fixture.script], { stdio: 'pipe', timeout: 10_000 });
      },
    })).toThrowError('Command failed:');
    expect(readFileSync(fixture.output, 'utf8')).toBe(previousOutput);
  });

  it('refreshes stale metadata using independent release manifest versions', () => {
    // Given: a fixture copies stale generated metadata before applying new release manifests.
    const fixture = createReleaseFixture();

    // When: the real build-time generator runs from an unrelated working directory.
    execFileSync(process.execPath, [fixture.script], { cwd: tmpdir(), timeout: 10_000 });

    // Then: the machine-consumed module covers every internal package except the CLI itself.
    const output = execFileSync(process.execPath, [
      '--input-type=module', '--eval',
      `import { PUBLISHED_INTERNAL_DEPENDENCIES } from ${JSON.stringify(pathToFileURL(fixture.output).href)}; console.log(JSON.stringify(PUBLISHED_INTERNAL_DEPENDENCIES));`,
    ], { encoding: 'utf8', timeout: 10_000 });
    expect(JSON.parse(output)).toEqual(Object.fromEntries(
      Object.entries(releaseVersions).filter(([name]) => name !== '@fluojs/cli')
        .map(([name, version]) => [name, `^${version}`]),
    ));
  });

  it.each([
    { name: '@fluojs/not-config', version: '2.4.1' },
    { name: '@fluojs/config', version: '' },
    { name: '@fluojs/config', version: null },
    { name: '@fluojs/config', version: 2 },
  ])('does not replace metadata when a release manifest is invalid: %j', (manifest) => {
    // Given: one malformed release input and a previously generated artifact.
    const fixture = createReleaseFixture();
    const previousOutput = readFileSync(fixture.output, 'utf8');
    writeFileSync(join(fixture.root, 'packages/config/package.json'), JSON.stringify(manifest));

    // When: build-time metadata generation encounters the invalid package identity/version.
    const result = spawnSync(process.execPath, [fixture.script], { encoding: 'utf8', timeout: 10_000 });

    // Then: the build fails instead of shipping a partial or guessed dependency range.
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TypeError');
    expect(readFileSync(fixture.output, 'utf8')).toBe(previousOutput);
  });
});
