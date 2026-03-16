import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

const createdDirectories: string[] = [];

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('CLI command runner', () => {
  it('uses the default target directory from a single-app workspace root', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'workspace-root', private: true, workspaces: ['apps/*'] }, null, 2),
    );
    mkdirSync(join(workspaceDirectory, 'apps', 'starter-app', 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'apps', 'starter-app', 'package.json'),
      JSON.stringify({ name: 'starter-app', private: true }, null, 2),
    );
    writeFileSync(join(workspaceDirectory, 'apps', 'starter-app', 'src', '.gitkeep'), '');

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'repo', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(workspaceDirectory, 'apps', 'starter-app', 'src', 'users', 'user.repo.ts'), 'utf8')).toContain('return [];');
    expect(stdoutBuffer.join('')).toContain('Generated 3 file(s):');
  });

  it('auto-detects the package manager from the calling context when no flag is provided', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      env: { npm_config_user_agent: 'npm/10.0.0 node/v22.0.0 darwin x64' },
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Installing dependencies with npm');
    expect(stdoutBuffer.join('')).toContain('npm run dev');
  });

  it('falls back to pnpm when package manager detection has no signal', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      env: {},
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Installing dependencies with pnpm');
    expect(stdoutBuffer.join('')).toContain('pnpm dev');
  });

  it('prints top-level usage for `help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti new <project-name>');
    expect(stdoutBuffer.join('')).toContain('Usage: konekti g <kind> <name>');
  });

  it('prints `new` usage for `new --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti new <project-name>');
    expect(stdoutBuffer.join('')).not.toContain('Usage: konekti g <kind> <name>');
  });

  it('prints generate usage for `help generate`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help', 'generate'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti g <kind> <name>');
    expect(stdoutBuffer.join('')).not.toContain('Usage: konekti new <project-name>');
  });

  it('places generated files under a domain subdirectory and auto-creates the module', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'service', 'Post'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('posts/post.service.ts');
    expect(stdoutBuffer.join('')).toContain('posts/post.module.ts');

    const moduleContent = readFileSync(join(workspaceDirectory, 'src', 'posts', 'post.module.ts'), 'utf8');
    expect(moduleContent).toContain('PostService');
    expect(moduleContent).toContain("from './post.service'");
  });

  it('registers controller into existing module when present', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    const domainDir = join(workspaceDirectory, 'src', 'orders');
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );
    writeFileSync(
      join(domainDir, 'order.module.ts'),
      `import { Module } from '@konekti/core';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass OrderModule {}\n\nexport { OrderModule };\n`,
    );

    const exitCode = await runCli(['g', 'controller', 'Order'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    const moduleContent = readFileSync(join(domainDir, 'order.module.ts'), 'utf8');
    expect(moduleContent).toContain('OrderController');
    expect(moduleContent).toContain("from './order.controller'");
  });

  it('creates a new starter project through the CLI', async () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
    const targetDirectory = mkdtempSync(join(tmpdir(), 'konekti-new-'));
    createdDirectories.push(targetDirectory);
    const stdoutBuffer: string[] = [];

    const projectDirectory = join(targetDirectory, 'starter-app');

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'pnpm'], {
      cwd: targetDirectory,
      dependencySource: 'local',
      repoRoot,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).toContain('@konekti/runtime');
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).not.toContain('@konekti/prisma');
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).not.toContain('@konekti/drizzle');
    expect(stdoutBuffer.join('')).toContain('Installing dependencies with pnpm');
    expect(existsSync(join(projectDirectory, 'node_modules'))).toBe(true);

    run('pnpm', ['typecheck'], projectDirectory);
    run('pnpm', ['build'], projectDirectory);
    run('pnpm', ['test'], projectDirectory);
    run('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], projectDirectory);
    expect(existsSync(join(projectDirectory, 'src', 'users', 'user.repo.ts'))).toBe(true);
  }, 60000);

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
