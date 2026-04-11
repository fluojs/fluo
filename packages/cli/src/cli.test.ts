import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { generatorManifest } from './generators/manifest.js';

const createdDirectories: string[] = [];

const inspectFixtureModulePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'inspect-app.module.mjs',
);

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('CLI command runner', () => {
  it('publishes fluo as the canonical bin', () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };

    expect(manifest.bin).toEqual({
      fluo: './bin/fluo.mjs',
    });
    expect(readFileSync(join(packageRoot, 'README.md'), 'utf8')).toContain('The canonical CLI for fluo');
  });

  it('uses the default target directory from a single-app workspace root', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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

  it('fails fast from a multi-app workspace root unless --target-directory is explicit', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'workspace-root', private: true, workspaces: ['apps/*'] }, null, 2),
    );

    for (const appName of ['starter-app', 'admin-app']) {
      mkdirSync(join(workspaceDirectory, 'apps', appName, 'src'), { recursive: true });
      writeFileSync(
        join(workspaceDirectory, 'apps', appName, 'package.json'),
        JSON.stringify({ name: appName, private: true }, null, 2),
      );
    }

    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'repo', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Use --target-directory to choose the app src directory explicitly.');
    expect(stdoutBuffer.join('')).toBe('');
    expect(existsSync(join(workspaceDirectory, 'users', 'user.repo.ts'))).toBe(false);
  });

  it('auto-detects the package manager from the calling context when no flag is provided', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      userAgent: 'npm/10.0.0 node/v22.0.0 darwin x64',
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('npm run dev');
  });

  it('falls back to pnpm when package manager detection has no signal', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('pnpm dev');
  });

  it('runs the interactive new wizard through injected answers without terminal emulation', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new'], {
      cwd: workspaceDirectory,
      interactive: true,
      prompt: {
        confirm: async (message) => message === 'Initialize a git repository',
        select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], _defaultValue?: T) => {
          switch (message) {
            case 'Starter shape':
              return 'microservice' as T;
            case 'Microservice transport':
              return 'tcp' as T;
            case 'Tooling preset':
              return 'standard' as T;
            case 'Package manager':
              return 'pnpm' as T;
            default:
              throw new Error(`Unexpected prompt: ${message}`);
          }
        },
        text: async () => 'wizard-app',
      },
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'wizard-app', '.git'))).toBe(true);
    expect(readFileSync(join(workspaceDirectory, 'wizard-app', 'README.md'), 'utf8')).toContain('Shape: `microservice`');
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
  });

  it('keeps non-interactive programmatic new flows as a first-class path', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      interactive: false,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'starter-app', '.git'))).toBe(false);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
  });

  it('honors explicit install and git flags without changing the scaffold model', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--no-install', '--git'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'starter-app', '.git'))).toBe(true);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
  });

  it('honors explicit yarn selection without changing the stable scaffold shape', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'yarn'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('yarn dev');
  });

  it('accepts explicit HTTP shape flags while preserving the default starter result', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'application',
      '--transport',
      'http',
      '--runtime',
      'node',
      '--platform',
      'fastify',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-app',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-app');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('cd ./starter-app');
    expect(packageJson).toContain('@fluojs/platform-fastify');
    expect(packageJson).toContain('@fluojs/runtime');
    expect(mainFile).toContain("createFastifyAdapter({ port })");
  });

  it('scaffolds the Express HTTP starter when the Express platform is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'application',
      '--transport',
      'http',
      '--runtime',
      'node',
      '--platform',
      'express',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-express',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-express');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(packageJson).toContain('@fluojs/platform-express');
    expect(mainFile).toContain('createExpressAdapter({ port })');
  });

  it('scaffolds the raw Node.js HTTP starter when the nodejs platform is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'application',
      '--transport',
      'http',
      '--runtime',
      'node',
      '--platform',
      'nodejs',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-nodejs',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-nodejs');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(packageJson).toContain('@fluojs/platform-nodejs');
    expect(mainFile).toContain('createNodejsAdapter({ port })');
  });

  it('scaffolds the TCP microservice starter when shape and transport are selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'microservice',
      '--transport',
      'tcp',
      '--runtime',
      'node',
      '--platform',
      'none',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-microservice',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-microservice');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('cd ./starter-microservice');
    expect(packageJson).toContain('@fluojs/microservices');
    expect(packageJson).not.toContain('@fluojs/platform-fastify');
    expect(mainFile).toContain('FluoFactory.createMicroservice(AppModule)');
  });

  it('scaffolds the mixed starter when the mixed shape is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'mixed',
      '--transport',
      'tcp',
      '--runtime',
      'node',
      '--platform',
      'fastify',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-mixed',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-mixed');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(projectDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(stdoutBuffer.join('')).toContain('cd ./starter-mixed');
    expect(packageJson).toContain('@fluojs/http');
    expect(packageJson).toContain('@fluojs/microservices');
    expect(mainFile).toContain('await app.connectMicroservice();');
    expect(mainFile).toContain('await app.startAllMicroservices();');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
  });

  it('reports validated-but-not-yet-runnable microservice transport families through the CLI contract', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--shape', 'microservice', '--transport', 'kafka', '--platform', 'none'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('The first-class microservice starter currently emits the runnable TCP starter');
  });

  it('scaffolds a local .env file while ignoring it from git by default', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-app');

    expect(exitCode).toBe(0);
    expect(readFileSync(join(projectDirectory, '.gitignore'), 'utf8')).toContain('.env');
    expect(readFileSync(join(projectDirectory, '.env'), 'utf8')).toContain('PORT=3000');
  });

  it('keeps Babel test-file ignore rules in babel.config.cjs instead of shell-quoted build args', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const exitCode = await runCli(['new', 'starter-app'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-app');
    const packageJson = JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8')) as {
      scripts: { build: string };
    };
    const babelConfig = readFileSync(join(projectDirectory, 'babel.config.cjs'), 'utf8');

    expect(exitCode).toBe(0);
    expect(packageJson.scripts.build).not.toContain('--ignore');
    expect(babelConfig).toContain("ignore: ['src/**/*.test.ts']");
  });

  it('keeps explicit --target-directory when it appears before positional project name', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--target-directory', 'custom-app', 'starter-app'], {
      cwd: workspaceDirectory,
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--target-directory', 'custom-app'], {
      cwd: workspaceDirectory,
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
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
    expect(stdoutBuffer.join('')).toContain('| Command  | Aliases | Description');
    expect(stdoutBuffer.join('')).toContain('| new      | create');
    expect(stdoutBuffer.join('')).toContain('| generate | g');
    expect(stdoutBuffer.join('')).toContain("Run 'fluo help <command>'");
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md');
  });

  it('prints `new` usage for `new --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo new|create [project-name] [options]');
    expect(stdoutBuffer.join('')).toMatch(/\| Option\s+\| Aliases \| Description\s+\|/);
    expect(stdoutBuffer.join('')).toContain('--shape <application|microservice|mixed>');
    expect(stdoutBuffer.join('')).toContain('--transport <http|tcp|redis|redis-streams|nats|kafka|rabbitmq|mqtt|grpc>');
    expect(stdoutBuffer.join('')).toContain('--runtime <node>');
    expect(stdoutBuffer.join('')).toContain('--platform <fastify|express|nodejs|none>');
    expect(stdoutBuffer.join('')).toContain('--tooling <standard>');
    expect(stdoutBuffer.join('')).toContain('--topology <single-package>');
    expect(stdoutBuffer.join('')).toContain('--package-manager <pnpm|npm|yarn|bun>');
    expect(stdoutBuffer.join('')).toContain('--install');
    expect(stdoutBuffer.join('')).toContain('--no-install');
    expect(stdoutBuffer.join('')).toContain('--git');
    expect(stdoutBuffer.join('')).toContain('--no-git');
    expect(stdoutBuffer.join('')).not.toContain('Schematics');
    expect(stdoutBuffer.join('')).toContain('Next steps:');
    expect(stdoutBuffer.join('')).toContain('cd <app-name>');
    expect(stdoutBuffer.join('')).toContain('pnpm dev');
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md');
  });

  it('prints `new` usage for `create --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['create', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo new|create [project-name] [options]');
  });

  it('prints generate usage for `help g`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help', 'g'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo generate|g <kind> <name> [options]');
    expect(stdoutBuffer.join('')).toMatch(/\| Schematic\s+\| Aliases\s+\| Wiring\s+\| Description\s+\|/);

    for (const entry of generatorManifest) {
      expect(stdoutBuffer.join('')).toContain(entry.schematic);
      expect(stdoutBuffer.join('')).toContain(entry.aliases.join(', '));
      expect(stdoutBuffer.join('')).toContain(entry.description);
    }

    expect(stdoutBuffer.join('')).toContain('| Option                    | Aliases | Description');
    expect(stdoutBuffer.join('')).not.toContain('Usage: fluo new|create');
    expect(stdoutBuffer.join('')).toContain('Next steps:');
    expect(stdoutBuffer.join('')).toContain("Run 'pnpm typecheck'");
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/generator-workflow.md');
  });

  it('prints inspect usage for `help inspect`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help', 'inspect'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo inspect <module-path> [options]');
    expect(stdoutBuffer.join('')).toContain('--mermaid');
    expect(stdoutBuffer.join('')).toContain('--timing');
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md');
  });

  it('emits platform snapshot JSON for inspect by default', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const exitCode = await runCli(['inspect', inspectFixtureModulePath], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const payload = JSON.parse(stdoutBuffer.join('')) as {
      components: unknown[];
      diagnostics: unknown[];
      generatedAt: string;
      health: {
        status: string;
      };
      readiness: {
        status: string;
      };
    };

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(payload.generatedAt).toEqual(expect.any(String));
    expect(payload.components).toEqual([]);
    expect(payload.diagnostics).toEqual([]);
    expect(payload.readiness.status).toBe('ready');
    expect(payload.health.status).toBe('healthy');
  });

  it('emits Mermaid dependency output for inspect', async () => {
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('graph TD');
    expect(stdoutBuffer.join('')).toContain('No registered platform components');
  });

  it('emits bootstrap timing diagnostics for inspect --timing', async () => {
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--timing'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const timing = JSON.parse(stdoutBuffer.join('')) as {
      phases: Array<{ durationMs: number; name: string }>;
      totalMs: number;
      version: number;
    };

    expect(exitCode).toBe(0);
    expect(timing.version).toBe(1);
    expect(timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(timing.phases.some((phase) => phase.name === 'bootstrap_module')).toBe(true);
  });

  it('rejects conflicting inspect output modes', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--json', '--timing'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Choose only one inspect output mode');
  });

  it('prints generate usage for `generate --help`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['generate', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo generate|g <kind> <name> [options]');

    for (const entry of generatorManifest) {
      expect(stdoutBuffer.join('')).toContain(entry.schematic);
    }
  });

  it('places generated files under a domain subdirectory and auto-creates the module', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const domainDir = join(workspaceDirectory, 'src', 'orders');
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );
    writeFileSync(
      join(domainDir, 'order.module.ts'),
      `import { Module } from '@fluojs/core';\n\n@Module({\n  controllers: [],\n  providers: [],\n})\nclass OrderModule {}\n\nexport { OrderModule };\n`,
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

  it('creates a new starter project scaffold through the CLI while keeping scaffold contract assertions', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-new-'));
    createdDirectories.push(targetDirectory);
    const stdoutBuffer: string[] = [];

    const projectDirectory = join(targetDirectory, 'starter-app');

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'pnpm'], {
      cwd: targetDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const packageJson = JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const readmeContent = readFileSync(join(projectDirectory, 'README.md'), 'utf8');
    const mainContent = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');
    const appTestContent = readFileSync(join(projectDirectory, 'src', 'app.test.ts'), 'utf8');
    const appE2eTestContent = readFileSync(join(projectDirectory, 'src', 'app.e2e.test.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).toContain('@fluojs/runtime');
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).toContain('@fluojs/platform-fastify');
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).not.toContain('@fluojs/prisma');
    expect(readFileSync(join(projectDirectory, 'package.json'), 'utf8')).not.toContain('@fluojs/drizzle');
    expect(packageJson.scripts?.typecheck).toBeDefined();
    expect(packageJson.scripts?.build).toBeDefined();
    expect(packageJson.scripts?.test).toBeDefined();
    expect(readFileSync(join(projectDirectory, '.gitignore'), 'utf8')).toContain('.env');
    expect(readFileSync(join(projectDirectory, '.env'), 'utf8')).toContain('PORT=3000');
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.repo.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.repo.test.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.service.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.service.test.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.response.dto.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.controller.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'health', 'health.controller.test.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'app.test.ts'))).toBe(true);
    expect(existsSync(join(projectDirectory, 'src', 'app.e2e.test.ts'))).toBe(true);
    expect(readmeContent).toContain('Starter contract: `src/main.ts` wires the selected first-class application starter: Node.js runtime + Fastify HTTP via `createFastifyAdapter(...)`');
    expect(readmeContent).toContain('Default baseline: when you omit `--platform`, `fluo new` still generates the Node.js + Fastify HTTP starter by default');
    expect(readmeContent).toContain('Broader runtime/adapter package coverage is documented in the fluo docs and package READMEs; this generated starter intentionally describes only the wired starter path above');
    expect(readmeContent).not.toContain('@fluojs/runtime/node');
    expect(readmeContent).not.toContain('@fluojs/platform-nodejs');
    expect(readmeContent).toContain('createFastifyAdapter');
    expect(readmeContent).toContain('runtime module entrypoints use governed canonical names');
    expect(mainContent).toContain("from '@fluojs/platform-fastify'");
    expect(mainContent).toContain('adapter: createFastifyAdapter({ port })');
    expect(mainContent).toContain('await app.listen();');
    expect(appTestContent).toContain("createRequest('/health')");
    expect(appTestContent).toContain("createRequest('/ready')");
    expect(appTestContent).toContain("createRequest('/health-info/')");
    expect(appE2eTestContent).toContain("path: '/health'");
    expect(appE2eTestContent).toContain("path: '/ready'");
    expect(appE2eTestContent).toContain("path: '/health-info/'");

  }, 90000);

  it('keeps the local sandbox outside the repo workspace', () => {
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
    const scriptPath = join(repoRoot, 'packages', 'cli', 'scripts', 'local-test-env.mjs');
    const fallbackRoot = join(tmpdir(), 'fluo-cli-sandbox');
    const internalOverrideRoot = join(repoRoot, '.sandbox-internal-test');
    const externalOverrideRoot = join(tmpdir(), `fluo-cli-external-${process.pid}`);
    const fallbackProjectName = `workspace-fallback-${process.pid}`;
    const externalProjectName = `workspace-external-${process.pid}`;

    const fallbackResult = spawnSync('node', [scriptPath, 'clean', fallbackProjectName], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FLUO_CLI_SANDBOX_ROOT: internalOverrideRoot,
      },
      stdio: 'pipe',
    });

    expect(fallbackResult.status).toBe(0);
    expect(fallbackResult.stdout).toContain(`Ignoring FLUO_CLI_SANDBOX_ROOT=${internalOverrideRoot}`);
    expect(fallbackResult.stdout).toContain(`Using sandbox root ${fallbackRoot}`);
    expect(fallbackResult.stdout).toContain(`Removed ${fallbackRoot}`);

    const preservedResult = spawnSync('node', [scriptPath, 'clean', externalProjectName], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FLUO_CLI_SANDBOX_ROOT: externalOverrideRoot,
      },
      stdio: 'pipe',
    });

    expect(preservedResult.status).toBe(0);
    expect(preservedResult.stdout).not.toContain('Ignoring FLUO_CLI_SANDBOX_ROOT=');
    expect(preservedResult.stdout).toContain(`Using sandbox root ${externalOverrideRoot}`);
    expect(preservedResult.stdout).toContain(`Removed ${externalOverrideRoot}`);
  });

  it('top-level help descriptions use canonical vocabulary', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Scaffold a new fluo application');
    expect(output).toContain('Generate a schematic');
    expect(output).toContain('Inspect runtime platform snapshot/diagnostics');
    expect(output).toContain('dry-run by default');
    expect(output).toContain('Show top-level or command-specific help');
  });

  it('top-level --help flag produces the same output as `help`', async () => {
    const helpBuffer: string[] = [];
    const flagBuffer: string[] = [];

    await runCli(['help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => helpBuffer.push(message) },
    });

    await runCli(['--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => flagBuffer.push(message) },
    });

    expect(flagBuffer.join('')).toBe(helpBuffer.join(''));
  });

  it('inspect usage describes platform snapshot and timing diagnostics consistently', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['inspect', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('platform snapshot');
    expect(output).toContain('diagnostics');
    expect(output).toContain('timing');
  });

  it('generate schematics help uses canonical provider/module registration vocabulary', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['generate', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('provider in the module');
    expect(output).toContain('persistence-agnostic');
    expect(output).toContain('route-level data binding');
    expect(output).toContain('Next steps:');
    expect(output).toContain("Run 'pnpm typecheck'");
  });

  it('returns a non-zero exit code for invalid commands', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['resource', 'repo', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('rejects unknown options for `new` before scaffolding side effects', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'berry'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Invalid --package-manager value "berry". Use one of: pnpm, npm, yarn, bun.');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('accepts bun as a supported package manager for `new`', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const exitCode = await runCli(['new', 'starter-app', '--package-manager', 'bun'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(workspaceDirectory, 'starter-app', 'package.json'), 'utf8')).toContain('"packageManager": "bun@1.2.5"');
  });

  it('rejects traversal-style project names for `new` before scaffolding side effects', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', '../starter-app'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('must not contain path separators or traversal sequences');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('rejects traversal-style project names provided through `--name`', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', '--name', 'bad\\app'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('must not contain path separators or traversal sequences');
    expect(existsSync(join(workspaceDirectory, 'bad\\app'))).toBe(false);
  });

  it('escapes generated TypeScript string literals for special project names', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const exitCode = await runCli(['new', "starter'app"], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(workspaceDirectory, "starter'app", 'src', 'health', 'health.repo.ts'), 'utf8')).toContain('service: "starter\'app"');
  });

  it('prints generate usage for an unknown schematic', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'unknown', 'User'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Usage: fluo generate|g <kind> <name> [options]');
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
    expect(stderrBuffer.join('')).toContain('Usage: fluo generate|g <kind> <name> [options]');
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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
    expect(stderrBuffer.join('')).toContain('Usage: fluo generate|g <kind> <name> [options]');
    expect(stderrBuffer.join('')).toMatch(/\|\s*request-dto\s*\|\s*req\s*\|/);
  });

  it('generate output includes CREATE prefix, wiring status, and next-step hint for auto-registered kinds', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
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

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('CREATE');
    expect(output).toContain('Wiring: auto-registered in');
    expect(output).toContain('Next steps:');
    expect(output).toContain('pnpm typecheck');
  });

  it('generate output shows files-only wiring and manual hint for non-registered kinds', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'request-dto', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('CREATE');
    expect(output).toContain('Wiring: files only');
    expect(output).toContain('manual registration required');
    expect(output).toContain('Next steps:');
  });

  it('generate help includes Wiring column with auto and manual labels', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['generate', '--help'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('| Wiring');
    expect(output).toContain('auto');
    expect(output).toContain('manual');
    expect(output).toContain('auto   = class is auto-registered in the domain module');
    expect(output).toContain('manual = files only');
  });

  it('prints migrate usage for `help migrate`', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['help', 'migrate'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo migrate <path> [options]');
    expect(stdoutBuffer.join('')).toContain('--apply');
    expect(stdoutBuffer.join('')).toContain('--only <comma-list>');
    expect(stdoutBuffer.join('')).toContain('Next steps:');
    expect(stdoutBuffer.join('')).toContain('--apply');
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/migrate-from-nestjs.md');
  });

  it('runs migrate in dry-run by default and only writes with --apply', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'main.ts'),
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
void bootstrap();
`,
    );

    const dryRunStdout: string[] = [];
    const dryRunExitCode = await runCli(['migrate', './src'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => dryRunStdout.push(message) },
    });

    expect(dryRunExitCode).toBe(0);
    expect(dryRunStdout.join('')).toContain('Mode: dry-run');
    expect(readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8')).toContain('NestFactory.create');

    const applyExitCode = await runCli(['migrate', './src', '--apply'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(applyExitCode).toBe(0);
    expect(readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8')).toContain('FluoFactory.create');
    expect(readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8')).toContain('await app.listen();');
  });
});
