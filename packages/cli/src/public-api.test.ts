import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type CliRuntimeOptions,
  type GeneratePlanAction,
  type GeneratePlanEntry,
  type GenerateResult,
  type InspectCommandRuntimeOptions,
  inspectUsage,
  type ModuleRegistration,
  type NewCommandRuntimeOptions,
  newUsage,
  runCli,
  runGenerateCommand,
  runInspectCommand,
  runNewCommand,
} from './index.js';

const tempDirectories: string[] = [];
const inspectFixtureModulePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'inspect-app.module.mjs',
);

function expectNoEagerCommandLink(source: string, commandName: 'generate' | 'inspect' | 'new'): void {
  const eagerCommandLink = new RegExp(
    String.raw`(?:^|\n)\s*(?:import\s+(?!type\b)[^;]+from|export\s+\{[^}]*\}\s+from)\s+['"]\./commands/${commandName}\.js['"]`,
  );

  expect(source).not.toMatch(eagerCommandLink);
}

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
    expect(rootEntrypoint).not.toContain("from './commands/generate.js'");
    expect(rootEntrypoint).not.toContain("from './commands/inspect.js'");
    expect(rootEntrypoint).not.toContain("from './commands/new.js'");
    expect(runCliFacade).toContain("await import('./cli.js')");
  });

  it('keeps root public command facades from eagerly linking command implementations', () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const rootEntrypoint = readFileSync(join(sourceRoot, 'index.ts'), 'utf8');
    const publicFacades = [
      ['generate', readFileSync(join(sourceRoot, 'public-generate.ts'), 'utf8')],
      ['inspect', readFileSync(join(sourceRoot, 'public-inspect.ts'), 'utf8')],
      ['new', readFileSync(join(sourceRoot, 'public-new.ts'), 'utf8')],
    ] as const;

    for (const [commandName, facadeSource] of publicFacades) {
      expect(rootEntrypoint).toContain(`from './public-${commandName}.js'`);
      expectNoEagerCommandLink(facadeSource, commandName);
    }
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

  it('keeps monorepo-local scaffold overrides out of the documented new runtime type', () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const newTypesSource = readFileSync(join(sourceRoot, 'new', 'types.ts'), 'utf8');
    const publicNewSource = readFileSync(join(sourceRoot, 'public-new.ts'), 'utf8');
    const newCommandOptionsBlock = newTypesSource.match(/export interface NewCommandOptions \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(newCommandOptionsBlock).not.toContain('dependencySource');
    expect(newCommandOptionsBlock).not.toContain('repoRoot');
    expect(publicNewSource).not.toContain('dependencySource');
    expect(publicNewSource).not.toContain('repoRoot');
  });

  it('executes runInspectCommand directly through the public facade', async () => {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    const exitCode = await runInspectCommand([inspectFixtureModulePath, '--json'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const payload = JSON.parse(stdoutBuffer.join('')) as {
      diagnostics: unknown[];
      health: { status: string };
      readiness: { status: string };
    };

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(payload.diagnostics).toEqual([]);
    expect(payload.readiness.status).toBe('ready');
    expect(payload.health.status).toBe('healthy');
  });
});
