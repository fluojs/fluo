import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATION_TRANSFORMS } from '../transforms/nestjs-migrate.js';
import { runMigrateCommand } from './migrate.js';
import { MIGRATION_TRANSFORM_CLI_TOKENS, parseMigrationTransformList } from './migration-transform-tokens.js';

const temporaryDirectories: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BOOTSTRAP_AUTOMATION_BOUNDARY =
  'fluo-cli-bootstrap-automation-boundary: explicit-platform-express, numeric-literal-single-argument-listen, manual-host-callback-string-env-multiple-listen';

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('documented migration transform tokens', () => {
  it('shares one canonical transform list with CLI token parsing', () => {
    expect(MIGRATION_TRANSFORM_CLI_TOKENS).toBe(MIGRATION_TRANSFORMS);
  });

  it.each([
    ['inject-params', 'injectable'],
    ['tests', 'testing'],
  ] as const)('normalizes legacy token %s to canonical %s', (legacyToken, canonicalToken) => {
    expect(parseMigrationTransformList(legacyToken, '--only')).toEqual([canonicalToken]);
  });

  it.each(MIGRATION_TRANSFORMS)('round-trips canonical token %s without aliases', (canonicalToken) => {
    expect(parseMigrationTransformList(canonicalToken, '--skip')).toEqual([canonicalToken]);
  });

  it('rejects unknown transform token values', () => {
    expect(() => parseMigrationTransformList('unknown', '--only')).toThrow(/unknown/);
  });

  it.each([
    'packages/cli/README.md',
    'packages/cli/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ])('keeps the bootstrap automation boundary in %s', (relativePath) => {
    // Given
    const documentation = readFileSync(resolve(repoRoot, relativePath), 'utf8');

    // When / Then
    expect(documentation).toContain(`<!-- ${BOOTSTRAP_AUTOMATION_BOUNDARY} -->`);
  });

  it('applies documented --only transform tokens', async () => {
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

class UsersModule {}

void Test.createTestingModule({ imports: [UsersModule] }).compile();
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
    const report: unknown = JSON.parse(stdoutBuffer.join(''));
    expect(report).toMatchObject({
      schemaVersion: 1,
      transforms: ['injectable', 'testing'],
      files: [
        {
          appliedTransforms: ['injectable'],
          filePath: servicePath,
        },
        {
          appliedTransforms: ['testing'],
          filePath: testPath,
        },
      ],
    });
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

  it.each(['constructor', '__proto__', 'toString'])('rejects inherited alias token "%s" at the CLI boundary', async (token) => {
    // Given
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];

    // When
    const exitCode = await runMigrateCommand(['./src', '--json', '--only', token], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    expect(exitCode).toBe(1);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toContain(`Unknown transform(s): ${token}`);
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
