import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('CLI command runner', () => {
  it('infers the preset and default target directory from a single-app workspace root', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'workspace-root', private: true, workspaces: ['apps/*'] }, null, 2),
    );
    mkdirSync(join(workspaceDirectory, 'apps', 'starter-app', 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'apps', 'starter-app', 'package.json'),
      JSON.stringify({ dependencies: { '@konekti/prisma': 'workspace:*' }, name: 'starter-app', private: true }, null, 2),
    );
    writeFileSync(join(workspaceDirectory, 'apps', 'starter-app', 'src', '.gitkeep'), '');

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'repo', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(workspaceDirectory, 'apps', 'starter-app', 'src', 'user.repo.ts'), 'utf8')).toContain(
      'this.prisma.current()',
    );
    expect(stdoutBuffer.join('')).toContain('Generated 2 file(s):');
  });

  it('creates a new starter project through the CLI', async () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
    const targetDirectory = mkdtempSync(join(tmpdir(), 'konekti-new-'));
    createdDirectories.push(targetDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--orm', 'Prisma', '--database', 'PostgreSQL', '--package-manager', 'pnpm'], {
      cwd: targetDirectory,
      dependencySource: 'local',
      repoRoot,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
      skipInstall: true,
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(targetDirectory, 'starter-app', 'package.json'), 'utf8')).toContain('@konekti/runtime');
    expect(stdoutBuffer.join('')).toContain('Installing dependencies with pnpm');
  });

  it('returns a non-zero exit code for invalid commands', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['resource', 'repo', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: konekti g <kind> <name>');
  });
});
