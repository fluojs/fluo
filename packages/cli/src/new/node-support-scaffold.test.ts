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

describe('generated Node support', () => {
  it.each(STARTER_PROFILE_REGISTRY)('emits runtime-specific metadata for $id', async (profile) => {
    // Given: each supported starter profile, including every microservice transport.
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-node-support-'));
    temporaryDirectories.push(targetDirectory);

    // When: the public scaffold writes a project.
    await scaffoldBootstrapApp({
      ...profile.schema,
      packageManager: 'pnpm',
      projectName: 'support-contract',
      skipInstall: true,
      starter: profile.starter,
      targetDirectory,
    });

    // Then: Node projects agree on engines, emitted code target, and Node typings.
    const manifest = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8'));
    if (profile.schema.runtime === 'node') {
      expect(manifest.engines).toEqual({ node: '>=24.0.0 <27' });
      expect(manifest.devDependencies['@types/node']).toMatch(/^\^24\./u);
      const configPath = profile.starter === 'react-vite-ssr' ? 'vite.server.config.ts' : 'vite.config.ts';
      const config = readFileSync(join(targetDirectory, configPath), 'utf8');
      expect(config.match(/target: '([^']+)'/u)?.[1]).toBe('node24');
    } else if (profile.schema.runtime === 'bun') {
      expect(manifest.engines).toEqual({ bun: '>=1.2.5' });
    } else if (profile.schema.runtime === 'deno') {
      expect(manifest.engines).toEqual({ deno: '>=2.0.0' });
    } else {
      // Workers' Node metadata belongs to shared local CLI/Wrangler tooling.
      expect(manifest.engines).toEqual({ node: '>=24.0.0 <27' });
    }
  });
});
