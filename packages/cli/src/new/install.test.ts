import { ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installDependencies, resolveInstallCommand } from './install.js';

const createdDirectories: string[] = [];

type SpawnOverride = () => ChildProcess;
type SpawnParameters = Parameters<typeof import('node:child_process').spawn>;

const spawnControl = vi.hoisted<{ override?: SpawnOverride }>(() => ({}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  return {
    ...actual,
    spawn: (...parameters: SpawnParameters) => spawnControl.override?.() ?? actual.spawn(...parameters),
  };
});

afterEach(() => {
  spawnControl.override = undefined;

  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createControlledChildProcess(): {
  readonly child: ChildProcess;
  readonly stderr: PassThrough;
  readonly stdout: PassThrough;
} {
  const child = new ChildProcess();
  const stderr = new PassThrough();
  const stdout = new PassThrough();

  Object.defineProperties(child, {
    stderr: { value: stderr },
    stdout: { value: stdout },
  });

  return { child, stderr, stdout };
}

function createExecutableFixture(commandName: string, script: string): { directory: string; env: NodeJS.ProcessEnv } {
  const directory = mkdtempSync(join(tmpdir(), `fluo-cli-install-${commandName}-`));
  createdDirectories.push(directory);

  const executablePath = join(directory, commandName);
  writeFileSync(executablePath, script, 'utf8');
  chmodSync(executablePath, 0o755);

  return {
    directory,
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
    },
  };
}

describe('resolveInstallCommand', () => {
  it('uses direct install commands for bun, pnpm, and npm', () => {
    expect(resolveInstallCommand('bun')).toEqual({
      args: ['install'],
      command: 'bun',
    });
    expect(resolveInstallCommand('pnpm')).toEqual({
      args: ['install'],
      command: 'pnpm',
    });
    expect(resolveInstallCommand('npm')).toEqual({
      args: ['install'],
      command: 'npm',
    });
  });

  it('uses the corepack yarn install path when corepack is available', () => {
    expect(resolveInstallCommand('yarn', { isCorepackAvailable: true })).toEqual({
      args: ['yarn', 'install'],
      command: 'corepack',
    });
  });

  it('falls back to direct yarn install when corepack is unavailable', () => {
    expect(resolveInstallCommand('yarn', { isCorepackAvailable: false })).toEqual({
      args: ['install'],
      command: 'yarn',
    });
  });

  it('captures full subprocess output when install fails in capture mode', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-target-'));
    createdDirectories.push(targetDirectory);
    const { env } = createExecutableFixture(
      'npm',
      '#!/bin/sh\nprintf "npm notice tarball contents\\n"\nprintf "npm error install failed\\n" 1>&2\nexit 2\n',
    );

    let thrownError: unknown;

    try {
      await installDependencies(targetDirectory, 'npm', {
        env,
        stdio: 'capture',
      });
    } catch (error: unknown) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('Dependency installation failed with exit code 2.');
    expect(thrownError).toMatchObject({
      output: expect.stringContaining('npm notice tarball contents\n'),
    });
    expect(thrownError).toMatchObject({
      output: expect.stringContaining('npm error install failed\n'),
    });
  });

  it('waits for close after a failed install child exits before rejecting captured output', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-target-'));
    createdDirectories.push(targetDirectory);
    const { child, stderr, stdout } = createControlledChildProcess();
    spawnControl.override = () => child;

    const installation = installDependencies(targetDirectory, 'npm', { stdio: 'capture' });
    let settledBeforeClose = false;
    void installation.then(
      () => {
        settledBeforeClose = true;
      },
      () => {
        settledBeforeClose = true;
      },
    );

    child.emit('exit', 2, null);
    stdout.write('npm notice stream after exit\n');
    stderr.write('npm error stream after exit\n');

    await Promise.resolve();
    expect(settledBeforeClose).toBe(false);

    child.emit('close', 2, null);
    await expect(installation).rejects.toMatchObject({
      output: 'npm notice stream after exit\nnpm error stream after exit\n',
    });
  });

  it('rejects immediately and ignores later child events when spawning an install fails', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-target-'));
    createdDirectories.push(targetDirectory);
    const { child, stderr, stdout } = createControlledChildProcess();
    const spawnError = new Error('spawn ENOENT');
    spawnControl.override = () => child;

    const installation = installDependencies(targetDirectory, 'npm', { stdio: 'capture' });
    const rejection = installation.then(
      () => new Error('Expected installation to reject.'),
      (error: unknown) => error,
    );
    child.emit('error', spawnError);
    await expect(rejection).resolves.toBe(spawnError);

    stdout.write('npm notice after spawn error\n');
    stderr.write('npm error after spawn error\n');
    child.emit('close', 1, null);
    await expect(rejection).resolves.toBe(spawnError);
  });

  it('surfaces the yarn corepack fallback warning through the provided stderr stream', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-target-'));
    createdDirectories.push(targetDirectory);
    const { env } = createExecutableFixture('yarn', '#!/bin/sh\nexit 0\n');
    const stderrBuffer: string[] = [];

    await installDependencies(targetDirectory, 'yarn', {
      env,
      isCorepackAvailable: false,
      stderr: {
        write(message: string) {
          stderrBuffer.push(message);
        },
      },
    });

    expect(stderrBuffer.join('')).toContain('corepack was not found in PATH');
  });
});
