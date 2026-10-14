import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const cliRequire = createRequire(require.resolve('@changesets/cli/package.json'));
const discoveryRequire = createRequire(cliRequire.resolve('@manypkg/get-packages'));
type Packages = { tool: string; packages: { packageJson: { name: string }; dir: string }[] };
const discovery: {
  getPackages(directory: string): Promise<Packages>;
  getPackagesSync(directory: string): Packages;
} = cliRequire('@manypkg/get-packages');
const readYaml: {
  (path: string): Promise<unknown>;
  sync(path: string): unknown;
} = discoveryRequire('read-yaml-file');
const temporaryDirectories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-security-consumers-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, '.changeset'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'release-fixture', private: true }));
  writeFileSync(join(directory, 'pnpm-workspace.yaml'), '\uFEFFpackages:\n  - "packages/*"\n  - "!packages/excluded"\n');
  for (const name of ['alpha', 'beta', 'excluded']) {
    mkdirSync(join(directory, 'packages', name), { recursive: true });
    writeFileSync(join(directory, 'packages', name, 'package.json'), JSON.stringify({
      name: `@fixture/${name}`,
      version: '1.0.0',
      ...(name === 'beta' ? { dependencies: { '@fixture/alpha': '1.0.0' } } : {}),
    }));
  }
  writeFileSync(join(directory, '.changeset', 'config.json'), JSON.stringify({
    changelog: false, commit: false, fixed: [], linked: [], access: 'public',
    baseBranch: 'main', updateInternalDependencies: 'patch', ignore: [],
  }));
  writeFileSync(join(directory, '.changeset', 'alpha.md'), '---\n"@fixture/alpha": minor\n---\n\nCompatible alpha feature.\n');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('installed Changesets YAML consumers', () => {
  it('readYaml: BOM and quoted workspace globs -> async and sync preserve parsed data', async () => {
    const directory = fixture();
    const path = join(directory, 'pnpm-workspace.yaml');

    const result = await readYaml(path);

    expect(result).toEqual({ packages: ['packages/*', '!packages/excluded'] });
    expect(readYaml.sync(path)).toEqual(result);
  });

  it('readYaml: malformed workspace YAML -> async and sync retain parser errors', async () => {
    const directory = fixture();
    const path = join(directory, 'pnpm-workspace.yaml');
    writeFileSync(path, 'packages: [\n');

    const result = readYaml(path);

    await expect(result).rejects.toMatchObject({ name: 'YAMLException', mark: { line: 1 } });
    expect(() => readYaml.sync(path)).toThrow();
    await expect(discovery.getPackages(directory)).rejects.toMatchObject({ name: 'YAMLException' });
    expect(() => discovery.getPackagesSync(directory)).toThrow();
  });

  it('readYaml: missing file -> async and sync retain ENOENT', async () => {
    const path = join(fixture(), 'absent.yaml');

    const result = readYaml(path);

    await expect(result).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => readYaml.sync(path)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('getPackages: YAML exclusions -> async and sync discover only included packages', async () => {
    const directory = fixture();

    const result = await discovery.getPackages(directory);

    expect(result.tool).toBe('pnpm');
    expect(result.packages.map(({ packageJson }) => packageJson.name).sort()).toEqual(['@fixture/alpha', '@fixture/beta']);
    expect(discovery.getPackagesSync(directory)).toEqual(result);
  });

  it('getPackages: actual workspace -> discovered package set matches workspace owners', async () => {
    const expected = ['apps', 'packages', 'tooling', 'examples'].flatMap((owner) =>
      readdirSync(join(root, owner)).flatMap((name) => {
        const path = join(root, owner, name, 'package.json');
        return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8')).name] : [];
      }),
    ).sort();

    const result = await discovery.getPackages(root);

    expect(result.packages.map(({ packageJson }) => packageJson.name).sort()).toEqual(expected);
    expect(discovery.getPackagesSync(root)).toEqual(result);
  });

  it('Changesets CLI: YAML workspace and changeset -> release plan and versioning preserve semver', () => {
    const directory = fixture();
    const output = join(directory, 'status.json');
    const cli = require.resolve('@changesets/cli/bin.js');
    const options = { cwd: directory, encoding: 'utf8', timeout: 30_000 } as const;
    execFileSync('git', ['init', '--initial-branch=main'], options);
    execFileSync('git', ['add', '.'], options);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initialize release fixture'], options);

    execFileSync(process.execPath, [cli, 'status', '--output', output], options);

    const plan = JSON.parse(readFileSync(output, 'utf8'));
    expect(plan.changesets).toMatchObject([{ id: 'alpha', releases: [{ name: '@fixture/alpha', type: 'minor' }] }]);
    expect(plan.releases).toMatchObject([
      { name: '@fixture/alpha', type: 'minor', oldVersion: '1.0.0', newVersion: '1.1.0' },
      { name: '@fixture/beta', type: 'patch', oldVersion: '1.0.0', newVersion: '1.0.1' },
    ]);
    execFileSync(process.execPath, [cli, 'version'], options);
    expect(JSON.parse(readFileSync(join(directory, 'packages/alpha/package.json'), 'utf8')).version).toBe('1.1.0');
    expect(JSON.parse(readFileSync(join(directory, 'packages/beta/package.json'), 'utf8'))).toMatchObject({
      version: '1.0.1', dependencies: { '@fixture/alpha': '1.1.0' },
    });
    expect(JSON.parse(readFileSync(join(directory, 'packages/excluded/package.json'), 'utf8')).version).toBe('1.0.0');
    expect(existsSync(join(directory, '.changeset/alpha.md'))).toBe(false);
  });
});
