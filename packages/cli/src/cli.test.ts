import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { generatorManifest } from './generators/manifest.js';

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
    expect(stdoutBuffer.join('')).toContain('Generated 4 file(s):');
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

  it('keeps explicit --target-directory when it appears before positional project name', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--target-directory', 'custom-app', 'starter-app'], {
      cwd: workspaceDirectory,
      env: {},
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'custom-app', 'package.json'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'starter-app', 'package.json'))).toBe(false);
    expect(stdoutBuffer.join('')).toContain('cd custom-app');
  });

  it('keeps explicit --target-directory when it appears after positional project name', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--target-directory', 'custom-app'], {
      cwd: workspaceDirectory,
      env: {},
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'custom-app', 'package.json'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'starter-app', 'package.json'))).toBe(false);
    expect(stdoutBuffer.join('')).toContain('cd custom-app');
  });

  it('prints top-level usage for `help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti <command> [options]');
    expect(stdoutBuffer.join('')).toContain('| Command  | Aliases | Description');
    expect(stdoutBuffer.join('')).toContain('| new      | create');
    expect(stdoutBuffer.join('')).toContain('| generate | g');
  });

  it('prints `new` usage for `new --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti new|create [project-name] [options]');
    expect(stdoutBuffer.join('')).toMatch(/\| Option\s+\| Aliases \| Description\s+\|/);
    expect(stdoutBuffer.join('')).toContain('--package-manager <pnpm|npm|yarn>');
    expect(stdoutBuffer.join('')).not.toContain('Schematics');
  });

  it('prints `new` usage for `create --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['create', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti new|create [project-name] [options]');
  });

  it('prints generate usage for `help g`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help', 'g'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti generate|g <kind> <name> [options]');
    expect(stdoutBuffer.join('')).toMatch(/\| Schematic\s+\| Aliases\s+\| Description\s+\|/);

    for (const entry of generatorManifest) {
      expect(stdoutBuffer.join('')).toContain(entry.schematic);
      expect(stdoutBuffer.join('')).toContain(entry.aliases.join(', '));
      expect(stdoutBuffer.join('')).toContain(entry.description);
    }

    expect(stdoutBuffer.join('')).toContain('| Option                    | Aliases | Description');
    expect(stdoutBuffer.join('')).not.toContain('Usage: konekti new|create');
  });

  it('prints generate usage for `generate --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['generate', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: konekti generate|g <kind> <name> [options]');

    for (const entry of generatorManifest) {
      expect(stdoutBuffer.join('')).toContain(entry.schematic);
    }
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
    expect(moduleContent).toContain('post.service');
  });

  it('accepts `repo` as the repository generator kind', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'repo', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.repo.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.module.ts'))).toBe(true);
  });

  it('accepts `repository` as the repository schematic name', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'repository', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.repo.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.module.ts'))).toBe(true);
  });

  it('accepts `request-dto` as a request DTO schematic', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'request-dto', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'create-users', 'create-user.request.dto.ts'))).toBe(true);
  });

  it('accepts `response-dto` as a response DTO schematic', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'response-dto', 'UserProfile'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'user-profiles', 'user-profile.response.dto.ts'))).toBe(true);
  });

  it('accepts `co` as a controller alias', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'co', 'Order'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'orders', 'order.controller.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'orders', 'order.module.ts'))).toBe(true);
  });

  it('accepts `mo` as a module alias', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'mo', 'Health'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'healths', 'health.module.ts'))).toBe(true);
  });

  it('accepts `s` as a service alias', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 's', 'Post'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'posts', 'post.service.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'posts', 'post.module.ts'))).toBe(true);
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
    expect(moduleContent).toContain('order.controller');
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
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.repo.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.service.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.response.dto.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'app.e2e.test.ts'))).toBe(true);

    run('pnpm', ['typecheck'], projectDirectory);
    run('pnpm', ['build'], projectDirectory);
    run('pnpm', ['test'], projectDirectory);
    run('pnpm', ['exec', 'konekti', 'g', 'repo', 'User'], projectDirectory);
    expect(existsSync(join(projectDirectory, 'src', 'users', 'user.repo.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'users', 'user.repo.slice.test.ts'))).toBe(true);
    run('pnpm', ['typecheck'], projectDirectory);
    run('pnpm', ['test'], projectDirectory);
  }, 90000);

  it('keeps the local sandbox outside the repo workspace', () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
    const scriptPath = join(repoRoot, 'packages', 'cli', 'scripts', 'local-test-env.mjs');
    const fallbackRoot = join(tmpdir(), 'konekti-cli-sandbox');
    const internalOverrideRoot = join(repoRoot, '.sandbox-internal-test');
    const externalOverrideRoot = join(tmpdir(), `konekti-cli-external-${process.pid}`);
    const fallbackProjectName = `workspace-fallback-${process.pid}`;
    const externalProjectName = `workspace-external-${process.pid}`;

    const fallbackResult = spawnSync('node', [scriptPath, 'clean', fallbackProjectName], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        KONEKTI_CLI_SANDBOX_ROOT: internalOverrideRoot,
      },
      stdio: 'pipe',
    });

    expect(fallbackResult.status).toBe(0);
    expect(fallbackResult.stdout).toContain(`Ignoring KONEKTI_CLI_SANDBOX_ROOT=${internalOverrideRoot}`);
    expect(fallbackResult.stdout).toContain(`Using sandbox root ${fallbackRoot}`);
    expect(fallbackResult.stdout).toContain(`Removed ${fallbackRoot}`);

    const preservedResult = spawnSync('node', [scriptPath, 'clean', externalProjectName], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        KONEKTI_CLI_SANDBOX_ROOT: externalOverrideRoot,
      },
      stdio: 'pipe',
    });

    expect(preservedResult.status).toBe(0);
    expect(preservedResult.stdout).not.toContain('Ignoring KONEKTI_CLI_SANDBOX_ROOT=');
    expect(preservedResult.stdout).toContain(`Using sandbox root ${externalOverrideRoot}`);
    expect(preservedResult.stdout).toContain(`Removed ${externalOverrideRoot}`);
  });

  it('returns a non-zero exit code for invalid commands', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['resource', 'repo', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: konekti <command> [options]');
  });

  it('rejects unknown options for `new` before scaffolding side effects', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--unknown-flag'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Unknown option for new command: --unknown-flag');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('rejects `new --package-manager` when the value is missing', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--package-manager'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Expected --package-manager to have a value.');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('rejects unsupported package-manager values for `new`', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'bun'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Invalid --package-manager value "bun". Use one of: pnpm, npm, yarn.');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('prints generate usage for an unknown schematic', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'unknown', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: konekti generate|g <kind> <name> [options]');
    expect(stderrBuffer.join('')).toMatch(/\|\s*repository\s*\|\s*repo\s*\|/);
  });

  it('prints generate usage when the schematic name is missing', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'repository'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: konekti generate|g <kind> <name> [options]');
    expect(stderrBuffer.join('')).toMatch(/\|\s*service\s*\|\s*s\s*\|/);
  });

  it('rejects malformed generate names that start with a hyphen', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'service', '-bad-name'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('names cannot start with "-"');
  });

  it('rejects duplicate --force flags', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'service', 'User', '--force', '--force'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Duplicate --force option.');
  });

  it('rejects duplicate --target-directory flags', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'service', 'User', '--target-directory', 'src', '--target-directory', 'lib'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Duplicate --target-directory option.');
  });

  it('rejects --target-directory values that look like options', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'service', 'User', '--target-directory', '--force'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Expected --target-directory to have a path value.');
  });

  it('resolves mi alias to middleware', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'mi', 'MyMiddleware'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
  });

  it('resolves gu alias to guard', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'gu', 'MyGuard'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
  });

  it('resolves `in` alias to interceptor', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'in', 'MyInterceptor'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
  });

  it('resolves `req` alias to request-dto', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'req', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
  });

  it('resolves `res` alias to response-dto', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'res', 'UserProfile'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
  });

  it('rejects the removed `dto` schematic name', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'dto', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: konekti generate|g <kind> <name> [options]');
    expect(stderrBuffer.join('')).toMatch(/\|\s*request-dto\s*\|\s*req\s*\|/);
  });
});
