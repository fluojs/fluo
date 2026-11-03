import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { DENO_MIGRATION_URL } from './deno-support.js';
import { runCli } from './index.js';
import { STARTER_PROFILE_REGISTRY, SUPPORTED_BOOTSTRAP_PLATFORMS, SUPPORTED_BOOTSTRAP_RUNTIMES } from './new/starter-profiles.js';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('retired Deno CLI support', () => {
  it('removes the Deno starter profile from the shipped registry and supported unions', () => {
    expect(STARTER_PROFILE_REGISTRY.map((profile) => profile.id)).not.toContain('application-deno-deno-http');
    expect(SUPPORTED_BOOTSTRAP_RUNTIMES).toEqual(['bun', 'cloudflare-workers', 'node']);
    expect(SUPPORTED_BOOTSTRAP_PLATFORMS).toEqual(['bun', 'cloudflare-workers', 'express', 'fastify', 'nodejs', 'none']);
  });

  it.each([
    ['--runtime', 'deno'],
    ['--platform', 'deno'],
  ] as const)('rejects explicit %s deno generation flags without scaffolding', async (flag, value) => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-deno-retired-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-deno', flag, value], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain(`${flag} ${value}`);
    expect(stderrBuffer.join('')).toContain(DENO_MIGRATION_URL);
    expect(existsSync(join(workspaceDirectory, 'starter-deno'))).toBe(false);
  });

  it.each(['dev', 'build', 'start'] as const)('rejects %s for legacy platform-deno manifests without spawning commands', async (command) => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-deno-retired-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ dependencies: { '@fluojs/platform-deno': '^1.0.0' }, name: 'test-app', scripts: { dev: 'fluo dev' } }, null, 2),
    );
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    let spawnCount = 0;

    const exitCode = await runCli([command], {
      cwd: workspaceDirectory,
      env: {},
      spawnCommand: async () => {
        spawnCount += 1;
        return 0;
      },
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(spawnCount).toBe(0);
    expect(stderrBuffer.join('')).toContain('@fluojs/platform-deno');
    expect(stderrBuffer.join('')).toContain(DENO_MIGRATION_URL);
    expect(stdoutBuffer.join('')).not.toContain('Would run:');
    expect(stdoutBuffer.join('')).not.toContain('node dist/main.js');
  });
});
