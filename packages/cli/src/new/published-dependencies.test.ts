import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldBootstrapApp } from './scaffold.js';
import { STARTER_PROFILE_REGISTRY } from './starter-profiles.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('published starter dependency ranges', () => {
  it.each(STARTER_PROFILE_REGISTRY)('uses each release manifest for $id', async (profile) => {
    // Given: release manifests are independent of the scaffold's dependency map.
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-published-dependencies-'));
    temporaryDirectories.push(targetDirectory);

    // When: a supported profile writes its real package.json without local overrides.
    await scaffoldBootstrapApp({
      ...profile.schema,
      dependencySource: 'published',
      packageManager: 'pnpm',
      projectName: 'published-starter',
      skipInstall: true,
      starter: profile.starter,
      targetDirectory,
    });

    // Then: both sections contain every internal dependency at its own release range.
    const manifest = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8'));
    expect(manifest).not.toHaveProperty('overrides');
    expect(manifest).not.toHaveProperty('resolutions');
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const internalNames = profile.dependencies[section].filter((name) => name.startsWith('@fluojs/'));
      expect(Object.keys(manifest[section]).filter((name) => name.startsWith('@fluojs/')).sort())
        .toEqual([...internalNames].sort());
      for (const name of internalNames) {
        const releaseManifest = JSON.parse(readFileSync(
          new URL(`../../../${name.slice('@fluojs/'.length)}/package.json`, import.meta.url),
          'utf8',
        ));
        expect(manifest[section][name], `${profile.id} ${section}.${name}`).toBe(`^${releaseManifest.version}`);
      }
    }
  });
});
