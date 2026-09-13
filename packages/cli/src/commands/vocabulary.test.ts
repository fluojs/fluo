import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../cli.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('canonical command vocabulary', () => {
  it('uses dry-run for a side-effect-free new preview without an update check', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    const stdout: string[] = [];
    let updateChecks = 0;

    const exitCode = await runCli([
      'new',
      'preview-app',
      '--dry-run',
      '--no-install',
      '--no-git',
      '--starter',
      'standard',
      '--shape',
      'application',
      '--runtime',
      'node',
      '--platform',
      'fastify',
      '--transport',
      'http',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      '--package-manager',
      'pnpm',
    ], {
      cwd: workspaceDirectory,
      env: {},
      interactive: true,
      stderr: { write: () => undefined },
      stdin: { isTTY: true },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: {
        cacheFile: join(workspaceDirectory, 'update-cache.json'),
        currentVersion: '1.0.0',
        fetchLatestVersion: async () => {
          updateChecks += 1;
          return '1.0.1';
        },
        interactive: true,
      },
    });

    expect(exitCode).toBe(0);
    expect(updateChecks).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'preview-app'))).toBe(false);
    expect(stdout.join('')).toContain('fluo new scaffold plan');
  });

  it('does not keep no-update-notifier as an update-check alias', async () => {
    const stderr: string[] = [];

    await expect(runCli(['analyze', '--no-update-notifier'], {
      env: {},
      stderr: { write: (message) => stderr.push(message) },
      stdout: { write: () => undefined },
      updateCheck: false,
    })).rejects.toThrow('Unknown analyze option: --no-update-notifier');
  });

  it.each([
    ['doctor', ['doctor']],
    ['info', ['info']],
    ['analyze', ['analyze']],
    ['help', ['--help']],
    ['version', ['--version']],
    ['new preview', ['new', 'preview-app', '--dry-run', '--no-install', '--no-git']],
  ] as const)('does not install or self-update for read-only %s invocations', async (_name, argv) => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    let updateChecks = 0;
    let updateInstalls = 0;
    let reruns = 0;

    const exitCode = await runCli([...argv], {
      cwd: workspaceDirectory,
      env: {},
      fetchDistTags: async () => ({ latest: '1.0.1' }),
      interactive: false,
      stderr: { write: () => undefined },
      stdin: { isTTY: true },
      stdout: { write: () => undefined },
      updateCheck: {
        cacheFile: join(workspaceDirectory, 'update-cache.json'),
        currentVersion: '1.0.0',
        fetchLatestVersion: async () => {
          updateChecks += 1;
          return '1.0.1';
        },
        installPackage: async () => {
          updateInstalls += 1;
          return 0;
        },
        interactive: true,
        prompt: { confirm: async () => true },
        rerunCli: async () => {
          reruns += 1;
          return 0;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(updateChecks).toBe(0);
    expect(updateInstalls).toBe(0);
    expect(reruns).toBe(0);
  });

  it.each([['--help'], ['--version'], ['analyze']] as const)('does not run an update check for %s', async (argument) => {
    let updateChecks = 0;

    const exitCode = await runCli([argument], {
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
      updateCheck: {
        cacheFile: join(tmpdir(), `fluo-cli-vocabulary-${argument.slice(2)}.json`),
        currentVersion: '1.0.0',
        fetchLatestVersion: async () => {
          updateChecks += 1;
          return '1.0.1';
        },
        interactive: true,
      },
    });

    expect(exitCode).toBe(0);
    expect(updateChecks).toBe(0);
  });

  it('accepts canonical migration tokens in versioned JSON reports', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'main.ts'), 'export const value = 1;\n');
    const stdout: string[] = [];

    const exitCode = await runCli(['migrate', '.', '--json', '--only', 'injectable,testing'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'migrate',
      transforms: ['injectable', 'testing'],
    });
  });

  it('rejects lifecycle package-manager input because it cannot affect execution', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app' }));
    const stderr: string[] = [];

    const exitCode = await runCli(['dev', '--package-manager', 'pnpm', '--dry-run'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: (message) => stderr.push(message) },
      stdout: { write: () => undefined },
      updateCheck: false,
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('--package-manager does not affect fluo dev');
  });

  it('honors package-manager selection for new dry-run install planning', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    const stdout: string[] = [];

    const exitCode = await runCli(['new', 'preview-app', '--dry-run', '--package-manager', 'bun'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Package manager: bun');
  });

  it('honors package-manager selection for add package workflows', async () => {
    const stdout: string[] = [];

    const exitCode = await runCli(['add', 'testing', '--dry-run', '--package-manager', 'npm'], {
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Would run: npm install --save @fluojs/testing');
  });
});
