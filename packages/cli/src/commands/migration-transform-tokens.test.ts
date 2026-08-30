import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runMigrateCommand } from './migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('documented migration transform tokens', () => {
  it('applies documented --only transform tokens', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.service.ts'),
      `import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
    );
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.spec.ts'),
      `import { Test } from '@nestjs/testing';

void Test;
`,
    );

    // When
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--json', '--only', 'inject-params,tests'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(stdoutBuffer.join('')).toContain('"injectable"');
    expect(stdoutBuffer.join('')).toContain('"testing"');
  });

  it('applies documented --skip transform tokens', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const servicePath = join(workspaceDirectory, 'src', 'users.service.ts');
    const testPath = join(workspaceDirectory, 'src', 'users.spec.ts');
    writeFileSync(
      servicePath,
      `import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
    );
    writeFileSync(
      testPath,
      `import { Test } from '@nestjs/testing';

void Test;
`,
    );

    // When
    const exitCode = await runMigrateCommand(['./src', '--apply', '--skip', 'tests'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    // Then
    expect(exitCode).toBe(0);
    expect(readFileSync(servicePath, 'utf8')).not.toContain('@Injectable');
    expect(readFileSync(testPath, 'utf8')).toContain('@nestjs/testing');
  });

  it('preserves stable transform values in default JSON reports', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('"injectable"');
    expect(stdoutBuffer.join('')).toContain('"testing"');
  });

  it('accepts the injectable alias at the CLI boundary', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.service.ts'),
      `import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
    );

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--json', '--only', 'injectable'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('"injectable"');
  });

  it('accepts the testing alias at the CLI boundary', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const testPath = join(workspaceDirectory, 'src', 'users.spec.ts');
    writeFileSync(
      testPath,
      `import { Test } from '@nestjs/testing';

void Test;
`,
    );

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--json', '--skip', 'testing'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('"injectable"');
    expect(stdoutBuffer.join('')).not.toContain('"testing"');
    expect(readFileSync(testPath, 'utf8')).toContain('@nestjs/testing');
  });
});
