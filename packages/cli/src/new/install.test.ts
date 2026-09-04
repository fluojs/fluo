import { ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installDependencies, resolveInstallCommand } from './install.js';

const createdDirectories: string[] = [];
const openServers: Server[] = [];
const openSockets: Socket[] = [];

type SpawnOverride = () => ChildProcess;
type SpawnObserver = (child: ChildProcess) => void;
type SpawnParameters = Parameters<typeof import('node:child_process').spawn>;

const spawnControl = vi.hoisted<{ observer?: SpawnObserver; override?: SpawnOverride }>(() => ({}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  return {
    ...actual,
    spawn: (...parameters: SpawnParameters) => {
      const child = spawnControl.override?.() ?? actual.spawn(...parameters);
      spawnControl.observer?.(child);
      return child;
    },
  };
});

afterEach(async () => {
  spawnControl.observer = undefined; spawnControl.override = undefined;

  for (const socket of openSockets.splice(0)) {
    socket.destroy();
  }

  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    ),
  );

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

  it('retains real buffered output after an install parent exits until both streams close', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-target-'));
    const socketDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-install-socket-'));
    const socketPath = join(socketDirectory, 'output.sock');
    createdDirectories.push(targetDirectory, socketDirectory);

    let markWriterReady: (socket: Socket) => void;
    const writerReady = new Promise<Socket>((resolve) => {
      markWriterReady = resolve;
    });
    const server = createServer((socket) => {
      openSockets.push(socket);
      socket.once('data', (message) => {
        if (message.toString() === 'ready') {
          markWriterReady(socket);
        }
      });
    });
    openServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    const { env } = createExecutableFixture(
      'npm',
      `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const childScript = ${JSON.stringify(`const { createConnection } = require('node:net');
const socket = createConnection(${JSON.stringify(socketPath)});
socket.once('connect', () => socket.write('ready'));
socket.once('data', (command) => {
  if (command.toString() === 'emit') { process.stdout.write('npm notice buffered output\\n'); process.stderr.write('npm error buffered output\\n'); socket.end(); }
});
socket.once('error', () => process.exit(0)); socket.once('close', () => process.exit(0));`)};
spawn(process.execPath, ['--eval', childScript], { stdio: ['ignore', 'inherit', 'inherit'] });
process.exit(2);
`,
    );

    const parentExited = new Promise<void>((resolve) => {
      spawnControl.observer = (child) => {
        child.once('exit', resolve);
      };
    });
    const installation = installDependencies(targetDirectory, 'npm', {
      env,
      stdio: 'capture',
    });
    let settlement = 'pending';
    void installation.then(
      () => {
        settlement = 'resolved';
      },
      () => {
        settlement = 'rejected';
      },
    );

    await parentExited;
    await new Promise<void>(queueMicrotask);
    expect(settlement).toBe('pending');

    const writer = await writerReady;
    writer.write('emit');

    await expect(installation).rejects.toMatchObject({
      output: expect.stringContaining('npm notice buffered output\n'),
    });
    await expect(installation).rejects.toMatchObject({
      output: expect.stringContaining('npm error buffered output\n'),
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
