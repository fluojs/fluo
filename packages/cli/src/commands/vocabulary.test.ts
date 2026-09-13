import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    const exitCode = await runCli(['analyze', '--no-update-notifier'], {
      env: {},
      stderr: { write: (message) => stderr.push(message) },
      stdout: { write: () => undefined },
      updateCheck: false,
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Unknown global option: --no-update-notifier');
  });

  it('rejects a leading removed global flag before update checking', async () => {
    const stderr: string[] = [];
    let updateChecks = 0;
    let prompts = 0;
    let installs = 0;

    const exitCode = await runCli(['--no-update-notifier', 'analyze'], {
      env: {},
      stderr: { isTTY: true, write: (message) => stderr.push(message) },
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: () => undefined },
      updateCheck: {
        currentVersion: '1.0.0',
        fetchLatestVersion: async () => {
          updateChecks += 1;
          return '1.0.1';
        },
        installPackage: async () => {
          installs += 1;
          return 0;
        },
        prompt: {
          confirm: async () => {
            prompts += 1;
            return true;
          },
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Unknown global option: --no-update-notifier');
    expect(updateChecks).toBe(0);
    expect(prompts).toBe(0);
    expect(installs).toBe(0);
  });

  it.each([
    ['doctor', ['doctor']],
    ['info', ['info']],
    ['analyze', ['analyze']],
  ] as const)('does not install or self-update for interactive diagnostics %s invocations', async (_name, argv) => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    let updateChecks = 0;
    let updateInstalls = 0;
    let reruns = 0;

    const exitCode = await runCli([...argv], {
      cwd: workspaceDirectory,
      env: {},
      fetchDistTags: async () => ({ latest: '1.0.1' }),
      interactive: true,
      stderr: { isTTY: true, write: () => undefined },
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: () => undefined },
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

  it.each([
    ['help', ['--help']],
    ['version', ['--version']],
  ] as const)('does not prompt, install, or rerun for interactive %s invocations', async (_name, argv) => {
    let updateChecks = 0;
    let prompts = 0;
    let updateInstalls = 0;
    let reruns = 0;

    const exitCode = await runCli([...argv], {
      env: {},
      stderr: { isTTY: true, write: () => undefined },
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: () => undefined },
      updateCheck: {
        cacheFile: join(tmpdir(), `fluo-cli-vocabulary-${argv[0].slice(2)}.json`),
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
        prompt: {
          confirm: async () => {
            prompts += 1;
            return true;
          },
        },
        rerunCli: async () => {
          reruns += 1;
          return 0;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(updateChecks).toBe(0);
    expect(prompts).toBe(0);
    expect(updateInstalls).toBe(0);
    expect(reruns).toBe(0);
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
      schemaVersion: 1,
      transforms: ['injectable', 'testing'],
    });
  });

  it('treats migrate --dry-run as the same non-writing preview as the default', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    const sourcePath = join(workspaceDirectory, 'main.ts');
    const source = "import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class Example {}\n";
    writeFileSync(sourcePath, source);
    const defaultOutput: string[] = [];
    const explicitOutput: string[] = [];

    const defaultExitCode = await runCli(['migrate', '.', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => defaultOutput.push(message) },
      updateCheck: false,
    });
    const explicitExitCode = await runCli(['migrate', '.', '--json', '--dry-run'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => explicitOutput.push(message) },
      updateCheck: false,
    });

    expect(defaultExitCode).toBe(0);
    expect(explicitExitCode).toBe(0);
    expect(JSON.parse(explicitOutput.join(''))).toEqual(JSON.parse(defaultOutput.join('')));
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);
  });

  it.each([
    [['migrate', '.', '--dry-run', '--apply'], '--dry-run'],
    [['migrate', '.', '--unknown-option'], '--unknown-option'],
  ] as const)('rejects invalid migrate arguments without writes', async (argv, expectedToken) => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    const sourcePath = join(workspaceDirectory, 'main.ts');
    const source = 'export const value = 1;\n';
    writeFileSync(sourcePath, source);
    const stderr: string[] = [];

    const exitCode = await runCli([...argv], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderr.push(message) },
      stdout: { write: () => undefined },
      updateCheck: false,
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain(expectedToken);
    expect(readFileSync(sourcePath, 'utf8')).toBe(source);
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
    expect(stderr.join('')).not.toBe('');
  });

  it('honors package-manager selection for new dry-run install planning', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.4.1' }));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-'));
    temporaryDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.4.1' }));
    const stdout: string[] = [];

    const exitCode = await runCli(['add', 'testing', '--dry-run', '--package-manager', 'npm'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('Would run: npm install --save @fluojs/testing');
  });

  it('documents add typing shortcuts beside their canonical options', async () => {
    const stdout: string[] = [];

    const exitCode = await runCli(['add', '--help'], {
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdout.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('--dev, -D');
    expect(stdout.join('')).toContain('--help, -h');
  });
});
