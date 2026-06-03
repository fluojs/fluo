import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectUsage,
  runGenerateCommand,
  runInspectCommand,
  type GeneratePlanAction,
  type GeneratePlanEntry,
  type GenerateResult,
  type InspectCommandRuntimeOptions,
  type ModuleRegistration,
} from './index.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('public CLI package API', () => {
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
});
