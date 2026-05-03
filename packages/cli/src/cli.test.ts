import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { generatorManifest } from './generators/manifest.js';
import { CliPromptCancelledError, runCli } from './index.js';

const createdDirectories: string[] = [];

const inspectFixtureModulePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'inspect-app.module.mjs',
);

const updateCheckEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
};

function createTtyBufferStream(buffer: string[]): { isTTY: true; write(message: string): void } {
  return {
    isTTY: true,
    write: (message: string) => {
      buffer.push(message);
    },
  };
}

function createUpdateCacheFile(): string {
  const cacheDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-update-'));
  createdDirectories.push(cacheDirectory);
  return join(cacheDirectory, 'cache.json');
}

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
      exports: Record<string, { import: string; types: string }>;
      files: string[];
      main?: string;
      private?: boolean;
      publishConfig?: { access?: string };
    };

    expect(manifest.bin).toEqual({
      fluo: './bin/fluo.mjs',
    });
    expect(manifest.private).toBe(false);
    expect(manifest.publishConfig?.access).toBe('public');
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.exports['.']).toEqual({
      import: './dist/index.js',
      types: './dist/index.d.ts',
    });
    expect(manifest.files).toEqual(['dist', 'bin']);
    expect(readFileSync(join(packageRoot, 'README.md'), 'utf8')).toContain('The canonical CLI for fluo');
    expect(readFileSync(join(packageRoot, 'README.md'), 'utf8')).toContain('dist-built CLI entrypoint');
    expect(readFileSync(join(packageRoot, 'README.ko.md'), 'utf8')).toContain('dist 빌드 CLI 엔트리포인트');
    expect(readFileSync(join(packageRoot, 'README.ko.md'), 'utf8')).toContain('# @fluojs/studio용 snapshot 내보내기');
  });

  it('keeps process ownership isolated to the binary entrypoint', () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const embeddableSourceFiles = [
      join(sourceRoot, 'commands', 'inspect.ts'),
      join(sourceRoot, 'commands', 'new.ts'),
      join(sourceRoot, 'new', 'prompt.ts'),
    ];

    for (const sourceFile of embeddableSourceFiles) {
      expect(readFileSync(sourceFile, 'utf8')).not.toContain('process.exit(');
    }

    expect(readFileSync(join(sourceRoot, '..', 'bin', 'fluo.mjs'), 'utf8')).toContain('process.exitCode = await runCli');
  });

  it('asks before installing a newer CLI and continues when the update is declined', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    let confirmMessage = '';
    let confirmDefault = true;

    const exitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        prompt: {
          confirm: async (message, defaultValue) => {
            confirmMessage = message;
            confirmDefault = defaultValue;
            return false;
          },
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toContain('A newer @fluojs/cli version is available: 1.0.0-beta.1 -> 1.0.0-beta.2.');
    expect(stderrBuffer.join('')).toContain('Continuing with @fluojs/cli@1.0.0-beta.1.');
    expect(confirmMessage).toBe('Install @fluojs/cli@1.0.0-beta.2 now and restart this command?');
    expect(confirmDefault).toBe(false);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('installs the accepted update and reruns the same CLI argv with update checks suppressed', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const installCommands: string[] = [];
    const rerunArgv: string[][] = [];
    const rerunEnvValues: Array<string | undefined> = [];

    const exitCode = await runCli(['help', 'new'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async (installCommand) => {
          installCommands.push(installCommand.display);
          return 0;
        },
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async (argv, runtime) => {
          rerunArgv.push([...argv]);
          rerunEnvValues.push(runtime.env.FLUO_UPDATE_CHECK_REEXEC);
          return 42;
        },
      },
    });

    expect(exitCode).toBe(42);
    expect(installCommands).toEqual(['npm install -g @fluojs/cli@1.0.0-beta.2']);
    expect(rerunArgv).toEqual([['help', 'new']]);
    expect(rerunEnvValues).toEqual(['1']);
    expect(stderrBuffer.join('')).toContain('Updated @fluojs/cli to 1.0.0-beta.2. Restarting fluo...');
    expect(stdoutBuffer.join('')).toBe('');
  });

  it.each([
    ['bun', 'bun add -g @fluojs/cli@1.0.0-beta.2'],
    ['npm', 'npm install -g @fluojs/cli@1.0.0-beta.2'],
    ['pnpm', 'pnpm add -g @fluojs/cli@1.0.0-beta.2'],
    ['yarn', 'yarn global add @fluojs/cli@1.0.0-beta.2'],
  ] as const)('uses %s for accepted CLI updates when that installer is detected', async (packageManager, expectedCommand) => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const installCommands: string[] = [];

    const exitCode = await runCli(['help'], {
      env: {
        ...updateCheckEnv,
        npm_config_user_agent: `${packageManager}/1.0.0 node/v20.0.0 darwin arm64`,
      },
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async (installCommand) => {
          installCommands.push(installCommand.display);
          return 0;
        },
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async () => 0,
      },
    });

    expect(exitCode).toBe(0);
    expect(installCommands).toEqual([expectedCommand]);
    expect(stderrBuffer.join('')).toContain(`Installing @fluojs/cli@1.0.0-beta.2 with \`${expectedCommand}\``);
  });

  it.each([
    ['bun', '/Users/example/.bun/bin/bun', 'bun add -g @fluojs/cli@1.0.0-beta.2'],
    ['npm', '/Users/example/.nvm/versions/node/v20.0.0/lib/node_modules/npm/bin/npm-cli.js', 'npm install -g @fluojs/cli@1.0.0-beta.2'],
    ['pnpm', '/Users/example/Library/pnpm/pnpm.cjs', 'pnpm add -g @fluojs/cli@1.0.0-beta.2'],
    ['yarn', '/Users/example/.yarn/bin/yarn.js', 'yarn global add @fluojs/cli@1.0.0-beta.2'],
  ] as const)('uses %s for accepted CLI updates when npm_execpath points at that installer', async (_packageManager, npmExecPath, expectedCommand) => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const installCommands: string[] = [];

    const exitCode = await runCli(['help'], {
      env: {
        ...updateCheckEnv,
        npm_execpath: npmExecPath,
      },
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async (installCommand) => {
          installCommands.push(installCommand.display);
          return 0;
        },
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async () => 0,
      },
    });

    expect(exitCode).toBe(0);
    expect(installCommands).toEqual([expectedCommand]);
  });

  it.each([
    ['bun', '/Users/example/.bun/install/global/node_modules/@fluojs/cli', 'bun add -g @fluojs/cli@1.0.0-beta.2'],
    ['npm', '/Users/example/.nvm/versions/node/v20.0.0/lib/node_modules/@fluojs/cli', 'npm install -g @fluojs/cli@1.0.0-beta.2'],
    ['pnpm', '/Users/example/Library/pnpm/global/5/node_modules/.pnpm/@fluojs+cli@1.0.0-beta.1/node_modules/@fluojs/cli', 'pnpm add -g @fluojs/cli@1.0.0-beta.2'],
    ['pnpm', '/Users/example/Library/pnpm/global/5/node_modules/@fluojs/cli', 'pnpm add -g @fluojs/cli@1.0.0-beta.2'],
    ['yarn', '/Users/example/.config/yarn/global/node_modules/@fluojs/cli', 'yarn global add @fluojs/cli@1.0.0-beta.2'],
  ] as const)('uses the package root as the install-owner signal for %s global installs', async (_packageManager, packageRoot, expectedCommand) => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const installCommands: string[] = [];

    const exitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        env: undefined,
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async (installCommand) => {
          installCommands.push(installCommand.display);
          return 0;
        },
        packageRoot,
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async () => 0,
      },
    });

    expect(exitCode).toBe(0);
    expect(installCommands).toEqual([expectedCommand]);
  });

  it('prefers the package root install-owner signal over launcher package-manager hints', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const installCommands: string[] = [];

    const exitCode = await runCli(['help'], {
      env: {
        ...updateCheckEnv,
        npm_config_user_agent: 'npm/10.0.0 node/v20.0.0 darwin arm64',
        npm_execpath: '/Users/example/.nvm/versions/node/v20.0.0/lib/node_modules/npm/bin/npm-cli.js',
      },
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async (installCommand) => {
          installCommands.push(installCommand.display);
          return 0;
        },
        packageRoot: '/Users/example/Library/pnpm/global/5/node_modules/@fluojs/cli',
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async () => 0,
      },
    });

    expect(exitCode).toBe(0);
    expect(installCommands).toEqual(['pnpm add -g @fluojs/cli@1.0.0-beta.2']);
  });

  it('continues the original CLI command when the accepted update install fails', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    let reran = false;

    const exitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        installPackage: async () => 7,
        prompt: {
          confirm: async () => true,
        },
        rerunCli: async () => {
          reran = true;
          return 0;
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(reran).toBe(false);
    expect(stderrBuffer.join('')).toContain('Update install failed with exit code 7; continuing with @fluojs/cli@1.0.0-beta.1.');
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('skips the update prompt in CI and non-TTY contexts', async () => {
    let fetchCount = 0;
    const fetchLatestVersion = async (): Promise<string> => {
      fetchCount += 1;
      return '1.0.0-beta.2';
    };

    const ciStdoutBuffer: string[] = [];
    const ciExitCode = await runCli(['help'], {
      ci: true,
      env: updateCheckEnv,
      stderr: createTtyBufferStream([]),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(ciStdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion,
      },
    });

    const nonTtyStdoutBuffer: string[] = [];
    const nonTtyExitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: { write: () => undefined },
      stdin: { isTTY: false },
      stdout: { write: (message) => nonTtyStdoutBuffer.push(message) },
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion,
      },
    });

    expect(ciExitCode).toBe(0);
    expect(nonTtyExitCode).toBe(0);
    expect(fetchCount).toBe(0);
    expect(ciStdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
    expect(nonTtyStdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('honors explicit update-check opt-out flags before command dispatch', async () => {
    let fetchCount = 0;
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['--no-update-check', 'help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream([]),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async (): Promise<string> => {
          fetchCount += 1;
          return '1.0.0-beta.2';
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(fetchCount).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
    expect(stdoutBuffer.join('')).toContain('--no-update-notifier');
  });

  it('uses the update-check cache instead of hitting npm on every invocation', async () => {
    const cacheFile = createUpdateCacheFile();
    let fetchCount = 0;

    const createRuntime = (stdoutBuffer: string[], stderrBuffer: string[]) => ({
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile,
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async (): Promise<string> => {
          fetchCount += 1;
          return '1.0.0-beta.2';
        },
        now: () => new Date('2026-04-26T00:00:00.000Z'),
        prompt: {
          confirm: async () => false,
        },
      },
    });

    const firstStdoutBuffer: string[] = [];
    const firstStderrBuffer: string[] = [];
    const secondStdoutBuffer: string[] = [];
    const secondStderrBuffer: string[] = [];

    await runCli(['help'], createRuntime(firstStdoutBuffer, firstStderrBuffer));
    await runCli(['help'], createRuntime(secondStdoutBuffer, secondStderrBuffer));

    expect(fetchCount).toBe(1);
    expect(firstStderrBuffer.join('')).toContain('A newer @fluojs/cli version is available');
    expect(secondStderrBuffer.join('')).toContain('A newer @fluojs/cli version is available');
  });

  it('does not prompt when the public CLI version is already current', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    let prompted = false;

    const exitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.2',
        fetchLatestVersion: async () => '1.0.0-beta.2',
        prompt: {
          confirm: async () => {
            prompted = true;
            return true;
          },
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(prompted).toBe(false);
    expect(stderrBuffer.join('')).toBe('');
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('ignores registry failures so the original CLI command still runs', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['help'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream(stderrBuffer),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '1.0.0-beta.1',
        fetchLatestVersion: async () => {
          throw new Error('registry unavailable');
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(stdoutBuffer.join('')).toContain('Usage: fluo <command> [options]');
  });

  it('passes migrate --json through the top-level dispatcher', async () => {
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

    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['migrate', './src', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const report = JSON.parse(stdoutBuffer.join('')) as { command: string; mode: string };
    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(report).toMatchObject({ command: 'migrate', mode: 'dry-run' });
  });

  it('keeps migrate parser failures on stderr when dispatched with --json', async () => {
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['migrate', './src', '--json', '--unknown'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toContain('Unknown option for migrate command: --unknown');
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

  it('scaffolds the Bun HTTP starter when the bun runtime is selected explicitly', async () => {
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
      'bun',
      '--platform',
      'bun',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-bun',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-bun');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(packageJson).toContain('@fluojs/platform-bun');
    expect(mainFile).toContain('createBunAdapter({ port })');
  });

  it('scaffolds the Deno HTTP starter when the deno runtime is selected explicitly', async () => {
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
      'deno',
      '--platform',
      'deno',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-deno',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-deno');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const mainFile = readFileSync(join(projectDirectory, 'src', 'main.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(packageJson).toContain('@fluojs/platform-deno');
    expect(mainFile).toContain('runDenoApplication(AppModule, { port })');
  });

  it('scaffolds the Cloudflare Workers HTTP starter when the cloudflare-workers runtime is selected explicitly', async () => {
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
      'cloudflare-workers',
      '--platform',
      'cloudflare-workers',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-workers',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-workers');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const workerFile = readFileSync(join(projectDirectory, 'src', 'worker.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Skipping dependency installation.');
    expect(packageJson).toContain('@fluojs/platform-cloudflare-workers');
    expect(workerFile).toContain('createCloudflareWorkerEntrypoint(AppModule)');
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

  it('scaffolds the Redis Streams microservice starter when the transport is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'microservice',
      '--transport',
      'redis-streams',
      '--runtime',
      'node',
      '--platform',
      'none',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-microservice-redis-streams',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-microservice-redis-streams');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const appFile = readFileSync(join(projectDirectory, 'src', 'app.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('cd ./starter-microservice-redis-streams');
    expect(packageJson).toContain('"ioredis": "^5.0.0"');
    expect(appFile).toContain('new RedisStreamsMicroserviceTransport({');
  });

  it('scaffolds the MQTT microservice starter when the transport is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'microservice',
      '--transport',
      'mqtt',
      '--runtime',
      'node',
      '--platform',
      'none',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-microservice-mqtt',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-microservice-mqtt');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const appFile = readFileSync(join(projectDirectory, 'src', 'app.ts'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('cd ./starter-microservice-mqtt');
    expect(packageJson).toContain('"mqtt": "^5.0.0"');
    expect(appFile).toContain('new MqttMicroserviceTransport({');
  });

  it('scaffolds the gRPC microservice starter when the transport is selected explicitly', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      '--shape',
      'microservice',
      '--transport',
      'grpc',
      '--runtime',
      'node',
      '--platform',
      'none',
      '--tooling',
      'standard',
      '--topology',
      'single-package',
      'starter-microservice-grpc',
    ], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const projectDirectory = join(workspaceDirectory, 'starter-microservice-grpc');
    const packageJson = readFileSync(join(projectDirectory, 'package.json'), 'utf8');
    const appFile = readFileSync(join(projectDirectory, 'src', 'app.ts'), 'utf8');
    const protoFile = readFileSync(join(projectDirectory, 'proto', 'math.proto'), 'utf8');

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('cd ./starter-microservice-grpc');
    expect(packageJson).toContain('"@grpc/grpc-js": "^1.0.0"');
    expect(packageJson).toContain('"@grpc/proto-loader": "^0.8.0"');
    expect(appFile).toContain('new GrpcMicroserviceTransport({');
    expect(protoFile).toContain('service MathService');
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

  it('prints an application scaffold plan without writing files, installing dependencies, or initializing git', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      'starter-app',
      '--shape',
      'application',
      '--runtime',
      'node',
      '--platform',
      'fastify',
      '--transport',
      'http',
      '--install',
      '--git',
      '--print-plan',
    ], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('fluo new scaffold plan');
    expect(output).toContain('Shape: application');
    expect(output).toContain('Runtime: node');
    expect(output).toContain('Platform: fastify');
    expect(output).toContain('Transport: http');
    expect(output).toContain('Starter recipe: application-node-fastify-http');
    expect(output).toContain('Package manager: pnpm');
    expect(output).toContain('Install dependencies: yes');
    expect(output).toContain('Initialize git: yes');
    expect(output).toContain('@fluojs/platform-fastify');
    expect(output).toContain('Side effects: none.');
    expect(output).not.toContain('Skipping dependency installation.');
    expect(output).not.toContain('Done.');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });

  it('prints a microservice scaffold plan with resolved defaults and no scaffold side effects', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli([
      'new',
      'starter-microservice',
      '--shape',
      'microservice',
      '--transport',
      'tcp',
      '--no-install',
      '--no-git',
      '--print-plan',
    ], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Project name: starter-microservice');
    expect(output).toContain('Shape: microservice');
    expect(output).toContain('Runtime: node');
    expect(output).toContain('Platform: none');
    expect(output).toContain('Transport: tcp');
    expect(output).toContain('Starter recipe: microservice-node-none-tcp');
    expect(output).toContain('Install dependencies: no');
    expect(output).toContain('Initialize git: no');
    expect(output).toContain('@fluojs/microservices');
    expect(existsSync(join(workspaceDirectory, 'starter-microservice'))).toBe(false);
  });

  it('prints an interactive mixed scaffold plan without creating the selected project', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new', '--print-plan'], {
      cwd: workspaceDirectory,
      interactive: true,
      prompt: {
        confirm: async (message) => message === 'Install dependencies now',
        select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
          if (message === 'Starter shape') {
            return 'mixed' as T;
          }

          return (defaultValue ?? 'pnpm') as T;
        },
        text: async () => 'starter-mixed-preview',
      },
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Project name: starter-mixed-preview');
    expect(output).toContain('Shape: mixed');
    expect(output).toContain('Runtime: node');
    expect(output).toContain('Platform: fastify');
    expect(output).toContain('Transport: tcp');
    expect(output).toContain('Starter recipe: mixed-node-fastify-tcp');
    expect(output).toContain('Install dependencies: yes');
    expect(output).toContain('Initialize git: no');
    expect(output).toContain('@fluojs/microservices');
    expect(output).toContain('@fluojs/platform-fastify');
    expect(existsSync(join(workspaceDirectory, 'starter-mixed-preview'))).toBe(false);
  });

  it('rejects transport values that are outside the shipped microservice starter contract', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['new', 'starter-app', '--shape', 'microservice', '--transport', 'redis', '--platform', 'none'], {
      cwd: workspaceDirectory,
      skipInstall: true,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Invalid --transport value "redis".');
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
    expect(stdoutBuffer.join('')).toContain('| Command  | Aliases');
    expect(stdoutBuffer.join('')).toContain('| new      | create');
    expect(stdoutBuffer.join('')).toContain('| generate | g');
    expect(stdoutBuffer.join('')).toContain('| doctor   | info');
    expect(stdoutBuffer.join('')).toContain('| dev      | -');
    expect(stdoutBuffer.join('')).toContain('| add      | -');
    expect(stdoutBuffer.join('')).toContain('| version  | --version, -v');
    expect(stdoutBuffer.join('')).toContain("Run 'fluo help <command>'");
    expect(stdoutBuffer.join('')).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md');
  });

  it('prints the installed CLI version without running the update check', async () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
    const stdoutBuffer: string[] = [];
    let fetchCount = 0;

    const exitCode = await runCli(['--version'], {
      env: updateCheckEnv,
      stderr: createTtyBufferStream([]),
      stdin: { isTTY: true },
      stdout: createTtyBufferStream(stdoutBuffer),
      updateCheck: {
        cacheFile: createUpdateCacheFile(),
        currentVersion: '0.0.0',
        fetchLatestVersion: async (): Promise<string> => {
          fetchCount += 1;
          return '999.0.0';
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(fetchCount).toBe(0);
    expect(stdoutBuffer.join('')).toBe(`${manifest.version}\n`);
  });

  it('supports the version command and short version flag', async () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };

    for (const argv of [['version'], ['-v']]) {
      const stdoutBuffer: string[] = [];

      const exitCode = await runCli(argv, {
        stderr: { write: () => undefined },
        stdout: { write: (message) => stdoutBuffer.push(message) },
      });

      expect(exitCode).toBe(0);
      expect(stdoutBuffer.join('')).toBe(`${manifest.version}\n`);
    }
  });

  it('prints doctor diagnostics with registry and update cache context', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { dev: 'tsx src/main.ts' } }, null, 2));
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['doctor'], {
      cwd: workspaceDirectory,
      fetchDistTags: async () => ({ beta: '1.0.0-beta.4', latest: '1.0.0-beta.5' }),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('fluo doctor');
    expect(output).toContain('npm latest: 1.0.0-beta.5');
    expect(output).toContain('Project scripts: dev');
  });

  it('prints info diagnostics through the direct info command', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { start: 'node dist/main.js' } }, null, 2));
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['info'], {
      cwd: workspaceDirectory,
      fetchDistTags: async () => ({ latest: '1.0.0-beta.5' }),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('fluo doctor');
    expect(output).toContain('npm latest: 1.0.0-beta.5');
    expect(output).toContain('Project scripts: start');
  });

  it('prints analyze guidance without mutating the project', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { build: 'tsc' } }, null, 2));
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['analyze'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('fluo analyze');
    expect(output).toContain('fluo inspect <module-path> --report');
  });

  it('prints development lifecycle dry-runs with Next.js-like env defaults', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { dev: 'fluo dev' } }, null, 2));
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['dev', '--dry-run', '--', '--port', '4000'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Would run: node --env-file=.env --watch --watch-preserve-output --import tsx src/main.ts --port 4000');
    expect(stdoutBuffer.join('')).toContain('NODE_ENV: development');
  });

  it('runs the production lifecycle directly while preserving explicit NODE_ENV', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', packageManager: 'yarn@4.5.0', scripts: { start: 'fluo start' } }, null, 2),
    );
    const spawned: Array<{ args: string[]; command: string; cwd: string; nodeEnv?: string }> = [];

    const exitCode = await runCli(['start', '--', '--host', '0.0.0.0'], {
      cwd: workspaceDirectory,
      env: { NODE_ENV: 'staging' },
      spawnCommand: async (command, args, options) => {
        spawned.push({ args, command, cwd: options.cwd, nodeEnv: options.env.NODE_ENV });
        return 0;
      },
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([{ args: ['dist/main.js', '--host', '0.0.0.0'], command: 'node', cwd: workspaceDirectory, nodeEnv: 'staging' }]);
  });

  it('defaults production lifecycle NODE_ENV to production when unset', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { start: 'fluo start' } }, null, 2));
    const spawned: Array<{ nodeEnv?: string }> = [];

    const exitCode = await runCli(['start'], {
      cwd: workspaceDirectory,
      env: {},
      spawnCommand: async (_command, _args, options) => {
        spawned.push({ nodeEnv: options.env.NODE_ENV });
        return 0;
      },
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([{ nodeEnv: 'production' }]);
  });

  it('ignores package-manager overrides for direct lifecycle runners', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { dev: 'fluo dev' } }, null, 2));
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['dev', '--dry-run', '--package-manager', 'npm'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Would run: node --env-file=.env --watch --watch-preserve-output --import tsx src/main.ts');
    expect(stdoutBuffer.join('')).toContain('NODE_ENV: development');
  });

  it('runs the Node build lifecycle directly with production env defaults', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { build: 'fluo build' } }, null, 2));
    const spawned: Array<{ args: string[]; command: string; cwd: string; nodeEnv?: string }> = [];

    const exitCode = await runCli(['build'], {
      cwd: workspaceDirectory,
      env: {},
      spawnCommand: async (command, args, options) => {
        spawned.push({ args, command, cwd: options.cwd, nodeEnv: options.env.NODE_ENV });
        return 0;
      },
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([
      { args: ['build'], command: 'vite', cwd: workspaceDirectory, nodeEnv: 'production' },
      { args: ['-p', 'tsconfig.build.json'], command: 'tsc', cwd: workspaceDirectory, nodeEnv: 'production' },
    ]);
  });

  it('prints runtime-specific build lifecycle dry-runs', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ dependencies: { '@fluojs/platform-bun': '^1.0.0' }, name: 'test-app', scripts: { build: 'fluo build' } }, null, 2),
    );
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['build', '--dry-run', '--', '--minify'], {
      cwd: workspaceDirectory,
      env: {},
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Would run: bun build ./src/main.ts --outdir ./dist --target bun --minify');
    expect(stdoutBuffer.join('')).toContain('NODE_ENV: production');
  });

  it('prints add dry-runs with normalized fluo package names', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['add', 'studio', '@fluojs/testing', '--dev', '--dry-run', '--package-manager', 'pnpm'], {
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Would run: pnpm add -D @fluojs/studio @fluojs/testing');
  });

  it('detects the add package manager from project lockfiles before user-agent fallback', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'package.json'), JSON.stringify({ name: 'test-app', private: true }, null, 2));
    writeFileSync(join(workspaceDirectory, 'yarn.lock'), '');
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['add', 'testing', '--dry-run'], {
      cwd: workspaceDirectory,
      env: { npm_config_user_agent: 'npm/10.8.0 node/v20.0.0 darwin arm64' },
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Would run: yarn add @fluojs/testing');
  });

  it('prints upgrade guidance with the latest CLI dist-tag', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['upgrade'], {
      fetchDistTags: async () => ({ latest: '1.0.0-beta.9' }),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Latest CLI: 1.0.0-beta.9');
    expect(stdoutBuffer.join('')).toContain('fluo migrate <path> --json');
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
    expect(stdoutBuffer.join('')).toContain('--transport <http|tcp|redis-streams|nats|kafka|rabbitmq|mqtt|grpc>');
    expect(stdoutBuffer.join('')).toContain('--runtime <node|bun|deno|cloudflare-workers>');
    expect(stdoutBuffer.join('')).toContain('--platform <fastify|express|nodejs|bun|deno|cloudflare-workers|none>');
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
    expect(stdoutBuffer.join('')).toContain('--dry-run');
    expect(stdoutBuffer.join('')).toContain('Collections');
    expect(stdoutBuffer.join('')).toContain('@fluojs/cli/builtin (built-in)');
    expect(stdoutBuffer.join('')).toContain('External or app-local generator collections are intentionally deferred');
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
    expect(stdoutBuffer.join('')).toContain('@fluojs/studio');
    expect(stdoutBuffer.join('')).toContain('--timing');
    expect(stdoutBuffer.join('')).toContain('--report');
    expect(stdoutBuffer.join('')).toContain('--output <path>');
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

  it('writes inspect JSON artifacts to an explicit output path without stdout payloads', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const outputPath = join(workspaceDirectory, 'artifacts', 'snapshot.json');

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--json', '--output', outputPath], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const payload = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      components: unknown[];
      diagnostics: unknown[];
      health: { status: string };
      readiness: { status: string };
    };

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toBe('');
    expect(payload.components).toEqual([]);
    expect(payload.diagnostics).toEqual([]);
    expect(payload.readiness.status).toBe('ready');
    expect(payload.health.status).toBe('healthy');
  });

  it('emits snapshot JSON with timing diagnostics when --json and --timing are combined', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--json', '--timing'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const payload = JSON.parse(stdoutBuffer.join('')) as {
      snapshot: {
        diagnostics: unknown[];
        health: { status: string };
        readiness: { status: string };
      };
      timing: {
        phases: Array<{ name: string }>;
        totalMs: number;
        version: number;
      };
    };

    expect(exitCode).toBe(0);
    expect(payload.snapshot.diagnostics).toEqual([]);
    expect(payload.snapshot.readiness.status).toBe('ready');
    expect(payload.snapshot.health.status).toBe('healthy');
    expect(payload.timing.version).toBe(1);
    expect(payload.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(payload.timing.phases.some((phase) => phase.name === 'bootstrap_module')).toBe(true);
  });

  it('emits a CI-friendly inspect report with summary, snapshot, and timing', async () => {
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--report'], {
      cwd: process.cwd(),
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const report = JSON.parse(stdoutBuffer.join('')) as {
      snapshot: { diagnostics: unknown[] };
      summary: {
        componentCount: number;
        diagnosticCount: number;
        errorCount: number;
        healthStatus: string;
        readinessStatus: string;
        timingTotalMs: number;
        warningCount: number;
      };
      timing: { totalMs: number; version: number };
      version: number;
    };

    expect(exitCode).toBe(0);
    expect(report.version).toBe(1);
    expect(report.summary).toEqual({
      componentCount: 0,
      diagnosticCount: 0,
      errorCount: 0,
      healthStatus: 'healthy',
      readinessStatus: 'ready',
      timingTotalMs: report.timing.totalMs,
      warningCount: 0,
    });
    expect(report.snapshot.diagnostics).toEqual([]);
    expect(report.timing.version).toBe(1);
    expect(report.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('delegates inspect --mermaid output to Studio when resolvable', async () => {
    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid'], {
      cwd: process.cwd(),
      loadStudioMermaidRenderer: async () => (snapshot) => `graph TD\n  STUDIO["components: ${snapshot.components.length}"]`,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toBe('graph TD\n  STUDIO["components: 0"]\n');
  });

  it('fails inspect --mermaid without prompting when Studio is missing in non-interactive mode', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid'], {
      ci: true,
      cwd: process.cwd(),
      interactive: false,
      loadStudioMermaidRenderer: async () => undefined,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdin: { isTTY: false },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toContain('Mermaid graph rendering is owned by @fluojs/studio');
    expect(stderrBuffer.join('')).toContain('not resolvable from this project');
    expect(stderrBuffer.join('')).toContain('pnpm add -D @fluojs/studio');
  });

  it('fails inspect --mermaid without installing when Studio installation is declined', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const promptMessages: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid'], {
      ci: true,
      cwd: process.cwd(),
      interactive: true,
      loadStudioMermaidRenderer: async () => undefined,
      prompt: {
        confirm: async (message) => {
          promptMessages.push(message);
          return false;
        },
        select: async () => {
          throw new Error('inspect should not request select prompts');
        },
        text: async () => {
          throw new Error('inspect should not request text prompts');
        },
      },
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdin: { isTTY: true },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(promptMessages).toEqual(['Install @fluojs/studio before rendering Mermaid output?']);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toContain('Installation declined; no package-manager command was run.');
  });

  it('returns success for cancelled inspect prompts without terminating the host process', async () => {
    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid'], {
      cwd: process.cwd(),
      interactive: true,
      loadStudioMermaidRenderer: async () => undefined,
      prompt: {
        confirm: async () => {
          throw new CliPromptCancelledError();
        },
        select: async () => {
          throw new Error('inspect should not request select prompts');
        },
        text: async () => {
          throw new Error('inspect should not request text prompts');
        },
      },
      stderr: { write: () => undefined },
      stdin: { isTTY: true },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
  });

  it('returns success for cancelled new prompts through the public embedding sentinel', async () => {
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];

    const exitCode = await runCli(['new'], {
      interactive: true,
      prompt: {
        confirm: async () => {
          throw new Error('fluo new should stop at the cancelled project name prompt');
        },
        select: async () => {
          throw new Error('fluo new should stop at the cancelled project name prompt');
        },
        text: async () => {
          throw new CliPromptCancelledError();
        },
      },
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdin: { isTTY: true },
      stdout: { write: (message) => stdoutBuffer.push(message) },
      updateCheck: false,
    });

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(stdoutBuffer.join('')).toBe('');
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

  it('rejects conflicting inspect JSON and Mermaid output modes', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--json', '--mermaid'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Choose only one inspect output mode');
  });

  it('rejects Mermaid timing because graph rendering stays Studio-owned', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['inspect', inspectFixtureModulePath, '--mermaid', '--timing'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Mermaid rendering remains delegated to @fluojs/studio');
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

  it('generates a complete resource slice', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'resource', 'User'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.module.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.controller.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.service.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.repo.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.response.dto.ts'))).toBe(true);
    expect(stdoutBuffer.join('')).toContain('Wiring: files only');
  });

  it('prints a resource dry-run plan without writing files', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['generate', 'resource', 'User', '--dry-run'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('Dry run: no files were written.');
    expect(output).toContain('src/users/user.module.ts');
    expect(output).toContain('src/users/user.controller.ts');
    expect(output).toContain('src/users/user.service.ts');
    expect(output).toContain('src/users/user.repo.ts');
    expect(output).toContain('src/users/create-user.request.dto.ts');
    expect(output).toContain('src/users/user.response.dto.ts');
    expect(output).toContain('Wiring: files only');
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.module.ts'))).toBe(false);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.controller.ts'))).toBe(false);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.service.ts'))).toBe(false);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.repo.ts'))).toBe(false);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(false);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'user.response.dto.ts'))).toBe(false);
  });

  it('accepts `request-dto` as a request DTO schematic with an explicit feature target', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'request-dto', 'users', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'create-users', 'create-user.request.dto.ts'))).toBe(false);
  });

  it('supports the canonical generate request-dto command with an explicit feature target', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['generate', 'request-dto', 'users', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(true);
  });

  it('normalizes PascalCase request DTO feature targets to plural slice directories', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const exitCode = await runCli(['g', 'req', 'User', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(true);
    expect(existsSync(join(workspaceDirectory, 'src', 'user', 'create-user.request.dto.ts'))).toBe(false);
  });

  it('keeps the legacy one-name request DTO form as a compatibility path', async () => {
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
    expect(output).toContain('Print the installed fluo CLI version');
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

  it('rejects duplicate --dry-run flags', async () => {
    const stderrBuffer: string[] = [];

    const exitCode = await runCli(['g', 'service', 'User', '--dry-run', '--dry-run'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Duplicate --dry-run option.');
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

    const exitCode = await runCli(['g', 'req', 'users', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(workspaceDirectory, 'src', 'users', 'create-user.request.dto.ts'))).toBe(true);
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

  it('prints a dry-run plan without writing files for auto-registered generate commands', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'service', 'Post', '--dry-run'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Dry run: no files were written.');
    expect(output).toContain('CREATE');
    expect(output).toContain('MODULE-CREATE');
    expect(output).toContain('Wiring: auto-registered in');
    expect(existsSync(join(workspaceDirectory, 'src', 'posts'))).toBe(false);
  });

  it('prints request DTO feature-target dry-run plans without creating feature directories', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'test-app', private: true }, null, 2),
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'req', 'users', 'CreateUser', '--dry-run'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Dry run: no files were written.');
    expect(output).toContain('users/create-user.request.dto.ts');
    expect(output).toContain('Wiring: files only');
    expect(existsSync(join(workspaceDirectory, 'src', 'users'))).toBe(false);
  });

  it('combines --dry-run with --force and --target-directory while leaving existing files untouched', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-'));
    createdDirectories.push(workspaceDirectory);

    const customSourceDirectory = join(workspaceDirectory, 'custom-src');
    const userDirectory = join(customSourceDirectory, 'users');
    const servicePath = join(userDirectory, 'user.service.ts');
    mkdirSync(userDirectory, { recursive: true });
    writeFileSync(servicePath, 'export class CustomUserService {}\n', 'utf8');

    const stdoutBuffer: string[] = [];
    const exitCode = await runCli(['g', 'service', 'User', '--dry-run', '--force', '--target-directory', 'custom-src'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('OVERWRITE');
    expect(output).toContain('custom-src/users/user.service.ts');
    expect(output).toContain('MODULE-CREATE');
    expect(readFileSync(servicePath, 'utf8')).toBe('export class CustomUserService {}\n');
    expect(existsSync(join(userDirectory, 'user.module.ts'))).toBe(false);
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
    const exitCode = await runCli(['g', 'request-dto', 'users', 'CreateUser'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');

    expect(exitCode).toBe(0);
    expect(output).toContain('CREATE');
    expect(output).toContain('users/create-user.request.dto.ts');
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
