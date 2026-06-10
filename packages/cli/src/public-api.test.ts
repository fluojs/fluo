import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectUsage,
  newUsage,
  runCli,
  runGenerateCommand,
  runInspectCommand,
  runNewCommand,
  type CliRuntimeOptions,
  type GeneratePlanAction,
  type GeneratePlanEntry,
  type GenerateResult,
  type InspectCommandRuntimeOptions,
  type ModuleRegistration,
  type NewCommandRuntimeOptions,
} from './index.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('public CLI package API', () => {
  it('keeps the root runCli export behind a lazy facade', () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const rootEntrypoint = readFileSync(join(sourceRoot, 'index.ts'), 'utf8');
    const runCliFacade = readFileSync(join(sourceRoot, 'run-cli.ts'), 'utf8');
    const runtimeOptions: CliRuntimeOptions = {
      ci: true,
    };

    expect(typeof runCli).toBe('function');
    expect(runtimeOptions.ci).toBe(true);
    expect(rootEntrypoint).not.toContain("from './cli.js'");
    expect(runCliFacade).toContain("await import('./cli.js')");
  });

  it('exports the documented generator and inspect programmatic surface from the root entrypoint', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-public-api-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result: GenerateResult = runGenerateCommand('middleware', 'Auth', sourceDirectory, { dryRun: true });
    const moduleRegistration: ModuleRegistration = {
      className: 'AuthMiddleware',
      kind: 'middleware',
    };
    const action: GeneratePlanAction = 'module-create';
    const planEntry: GeneratePlanEntry = {
      action,
      path: join(sourceDirectory, 'auths', 'auth.module.ts'),
    };
    const inspectRuntimeOptions: InspectCommandRuntimeOptions = {
      ci: true,
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: () => undefined },
    };

    expect(typeof runGenerateCommand).toBe('function');
    expect(typeof runInspectCommand).toBe('function');
    expect(inspectUsage()).toContain('Usage: fluo inspect');
    expect(result.wiringBehavior).toBe('auto-registered');
    expect(result.moduleRegistered).toBe(true);
    expect(result.plannedFiles.map((entry) => entry.action)).toContain('module-create');
    expect(moduleRegistration.kind).toBe('middleware');
    expect(planEntry.action).toBe('module-create');
    expect(inspectRuntimeOptions.ci).toBe(true);
  });

  it('exports the documented new command programmatic surface from the root entrypoint', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-public-api-'));
    tempDirectories.push(workspaceDirectory);
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];
    const runtimeOptions: NewCommandRuntimeOptions = {
      cwd: workspaceDirectory,
      interactive: false,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    };

    const exitCode = await runNewCommand(['starter-app', '--print-plan', '--no-install', '--no-git'], runtimeOptions);

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(newUsage()).toContain('Usage: fluo new|create');
    expect(stdoutBuffer.join('')).toContain('fluo new scaffold plan');
    expect(stdoutBuffer.join('')).toContain('Project name: starter-app');
    expect(stdoutBuffer.join('')).toContain('Side effects: none.');
    expect(existsSync(join(workspaceDirectory, 'starter-app'))).toBe(false);
  });
});
