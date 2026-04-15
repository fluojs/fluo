import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { installDependencies, resolveInstallCommand } from './install.js';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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
      output: 'npm notice tarball contents\nnpm error install failed\n',
    });
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
