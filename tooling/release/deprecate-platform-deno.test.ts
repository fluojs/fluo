import { describe, expect, it } from 'vitest';
import { deprecationMessage, runDenoDeprecation } from './deprecate-platform-deno.mjs';

const manifest = {
  name: '@fluojs/platform-deno',
  version: '2.0.2',
  description: 'Deprecated: Deno HTTP adapter.',
};

function registry(deprecated?: string) {
  return {
    'dist-tags': { latest: manifest.version },
    versions: {
      '1.0.0-beta.2': { description: 'Old adapter.', deprecated },
      '2.0.2': { description: manifest.description, deprecated },
    },
  };
}

describe('runDenoDeprecation', () => {
  it('does not write metadata before the advisory version is published', async () => {
    const calls: string[] = [];
    const published = {
      'dist-tags': { latest: '2.0.1' },
      versions: { '2.0.1': { description: 'Deno HTTP adapter.' } },
    };

    const result = await runDenoDeprecation(manifest, {
      readRegistry: async () => published,
      checkMigration: async () => { calls.push('guide'); },
      deprecate: async () => { calls.push('write'); },
    });

    expect(result.status).toBe('pending-advisory-release');
    expect(calls).toEqual([]);
  });

  it('does not accept a published version without the shipped advisory metadata', async () => {
    const published = registry();
    published.versions['2.0.2'].description = 'Deno HTTP adapter.';

    const result = await runDenoDeprecation(manifest, { readRegistry: async () => published });

    expect(result.status).toBe('pending-advisory-release');
  });

  it('checks the public migration before writing and verifies every version including prereleases', async () => {
    const calls: string[] = [];
    let published = registry();

    const result = await runDenoDeprecation(manifest, {
      readRegistry: async () => { calls.push('read'); return published; },
      checkMigration: async () => { calls.push('guide'); },
      deprecate: async () => { calls.push('write'); published = registry(deprecationMessage); },
    });

    expect(calls).toEqual(['read', 'guide', 'write', 'read']);
    expect(result).toEqual({ status: 'deprecated', version: manifest.version, versions: 2 });
  });

  it('does not mutate npm if the migration guide is unavailable', async () => {
    let written = false;

    await expect(runDenoDeprecation(manifest, {
      readRegistry: async () => registry(),
      checkMigration: async () => { throw new Error('HTTP 404'); },
      deprecate: async () => { written = true; },
    })).rejects.toThrow('HTTP 404');

    expect(written).toBe(false);
  });

  it('fails verification when an older prerelease remains without metadata', async () => {
    const incomplete = registry(deprecationMessage);
    incomplete.versions['1.0.0-beta.2'].deprecated = undefined;

    await expect(runDenoDeprecation(manifest, {
      readRegistry: async () => incomplete,
      checkMigration: async () => {},
      deprecate: async () => {},
    })).rejects.toThrow('1.0.0-beta.2');
  });

  it('can rerun after publishing without repeating a completed metadata write', async () => {
    let written = false;

    const result = await runDenoDeprecation(manifest, {
      readRegistry: async () => registry(deprecationMessage),
      checkMigration: async () => {},
      deprecate: async () => { written = true; },
    });

    expect(result.status).toBe('deprecated');
    expect(written).toBe(false);
  });

  it('propagates npm write failures instead of reporting deprecation success', async () => {
    await expect(runDenoDeprecation(manifest, {
      readRegistry: async () => registry(),
      checkMigration: async () => {},
      deprecate: async () => { throw new Error('E403'); },
    })).rejects.toThrow('E403');
  });

  it('rejects an incomplete registry response without writing metadata', async () => {
    let written = false;

    await expect(runDenoDeprecation(manifest, {
      readRegistry: async () => ({ 'dist-tags': { latest: manifest.version }, versions: {} }),
      deprecate: async () => { written = true; },
    })).rejects.toThrow('registry latest version metadata');

    expect(written).toBe(false);
  });
});
