import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectBootstrapAnswers, detectPackageManager, resolveBootstrapAnswers, type BootstrapPrompter } from './prompt.js';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';
import { CliPromptCancelledError } from '../prompt-cancel.js';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('detectPackageManager', () => {
  it('detects bun from npm_config_user_agent', () => {
    expect(detectPackageManager(process.cwd(), 'bun/1.2.5 npm/? node/v22.0.0 darwin arm64')).toBe('bun');
  });

  it('detects bun from bun lockfiles in parent directories', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-prompt-'));
    const nestedDirectory = join(workspaceDirectory, 'apps', 'starter-app');
    createdDirectories.push(workspaceDirectory);

    writeFileSync(join(workspaceDirectory, 'bun.lock'), 'lockfileVersion = 1\n');

    expect(detectPackageManager(nestedDirectory)).toBe('bun');
  });
});

describe('resolveBootstrapAnswers', () => {
  it('uses the detected bun package manager when none is provided explicitly', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-prompt-'));
    createdDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'workspace', packageManager: 'bun@1.2.5' }, null, 2),
    );

    expect(resolveBootstrapAnswers({ projectName: 'starter-app' }, workspaceDirectory)).toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'bun',
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });
});

describe('collectBootstrapAnswers', () => {
  function createPrompt(overrides: Partial<BootstrapPrompter>): BootstrapPrompter {
    return {
      confirm: async () => false,
      select: async <T extends string>(_message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (!defaultValue) {
          throw new Error('Expected default value.');
        }

        return defaultValue;
      },
      text: async () => 'starter-app',
      ...overrides,
    };
  }

  it('presents exactly three deduplicated starter-shape choices', async () => {
    let starterShapeChoices: readonly { label: string; value: string }[] = [];

    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          starterShapeChoices = choices;
          return 'application' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt });

    expect(starterShapeChoices).toEqual([
      { label: 'Application', value: 'application' },
      { label: 'Microservice', value: 'microservice' },
      { label: 'Mixed', value: 'mixed' },
    ]);
  });

  it('collects the application wizard path without terminal emulation', async () => {
    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          return 'application' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).resolves.toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'pnpm',
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });

  it('lets the application wizard choose Express explicitly while preserving Node defaults', async () => {
    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          return 'application' as T;
        }

        if (message === 'HTTP platform') {
          return 'express' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).resolves.toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'pnpm',
      platform: 'express',
      runtime: 'node',
      shape: 'application',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });

  it('maps non-node application runtimes to their native platform branches automatically', async () => {
    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          return 'application' as T;
        }

        if (message === 'Runtime') {
          return 'cloudflare-workers' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).resolves.toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'pnpm',
      platform: 'cloudflare-workers',
      runtime: 'cloudflare-workers',
      shape: 'application',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });

  it('branches through the microservice transport wizard path', async () => {
    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          return 'microservice' as T;
        }

        if (message === 'Microservice transport') {
          return 'kafka' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).resolves.toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'pnpm',
      platform: 'none',
      runtime: 'node',
      shape: 'microservice',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'kafka',
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });

  it('resolves the mixed wizard path onto the fixed mixed starter contract', async () => {
    const prompt = createPrompt({
      confirm: async (_message, defaultValue) => defaultValue,
      select: async <T extends string>(message: string, _choices: readonly { label: string; value: T }[], defaultValue?: T) => {
        if (message === 'Starter shape') {
          return 'mixed' as T;
        }

        return (defaultValue ?? 'pnpm') as T;
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).resolves.toEqual({
      initializeGit: false,
      installDependencies: true,
      packageManager: 'pnpm',
      platform: 'fastify',
      runtime: 'node',
      shape: 'mixed',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });

  it('surfaces wizard cancellation as an embeddable error instead of exiting the process', async () => {
    const prompt = createPrompt({
      text: async () => {
        throw new CliPromptCancelledError();
      },
    });

    await expect(collectBootstrapAnswers({}, process.cwd(), undefined, { interactive: true, prompt })).rejects.toBeInstanceOf(CliPromptCancelledError);
  });
});
