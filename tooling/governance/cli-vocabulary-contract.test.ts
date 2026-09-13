import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../../packages/cli/src/cli.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createStreams() {
  const stderr: string[] = [];
  const stdout: string[] = [];

  return {
    stderr,
    runtime: {
      env: {},
      stderr: { write: (message: string) => stderr.push(message) },
      stdout: { write: (message: string) => stdout.push(message) },
      updateCheck: false as const,
    },
    stdout,
  };
}

describe('CLI vocabulary governance contract', () => {
  it.each([
    [['new', 'example', '--print-plan'], '--print-plan'],
    [['generate', 'module', 'example', '--with-test'], '--with-test'],
    [['--no-update-notifier', 'analyze'], '--no-update-notifier'],
  ])('rejects removed CLI input %s', async (argv, removedFlag) => {
    const { runtime, stderr } = createStreams();

    const exitCode = await runCli(argv, runtime);

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain(removedFlag);
  });

  it('keeps canonical migration tokens and the versioned JSON report stable', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-governance-'));
    temporaryDirectories.push(workspaceDirectory);
    writeFileSync(join(workspaceDirectory, 'main.ts'), 'export const value = 1;\n');
    const { runtime, stdout } = createStreams();

    const exitCode = await runCli(['migrate', '.', '--json', '--only', 'injectable,testing'], {
      ...runtime,
      cwd: workspaceDirectory,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      schemaVersion: 1,
      transforms: ['injectable', 'testing'],
    });

    const legacyStreams = createStreams();
    const legacyExitCode = await runCli(['migrate', '.', '--json', '--only', 'inject-params,tests'], {
      ...legacyStreams.runtime,
      cwd: workspaceDirectory,
    });

    expect(legacyExitCode).toBe(0);
    expect(JSON.parse(legacyStreams.stdout.join(''))).toMatchObject({
      schemaVersion: 1,
      transforms: ['injectable', 'testing'],
    });
  });

  it('keeps canonical generator, help, and update-check options executable', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-vocabulary-governance-'));
    temporaryDirectories.push(workspaceDirectory);
    const generatorStreams = createStreams();

    const generatorExitCode = await runCli(['generate', 'module', 'example', '--dry-run', '--with-slice-test'], {
      ...generatorStreams.runtime,
      cwd: workspaceDirectory,
    });

    expect(generatorExitCode).toBe(0);
    expect(generatorStreams.stdout.join('')).toContain('example.slice.test.ts');

    const helpStreams = createStreams();
    const helpExitCode = await runCli(['add', '--help'], helpStreams.runtime);

    expect(helpExitCode).toBe(0);
    expect(helpStreams.stdout.join('')).toContain('--dev, -D');
    expect(helpStreams.stdout.join('')).toContain('--help, -h');

    let updateChecks = 0;
    const updateStreams = createStreams();
    const updateExitCode = await runCli(['upgrade', '--no-update-check'], {
      ...updateStreams.runtime,
      fetchDistTags: async () => ({ latest: '1.0.1' }),
      updateCheck: {
        currentVersion: '1.0.0',
        fetchLatestVersion: async () => {
          updateChecks += 1;
          return '1.0.1';
        },
      },
    });

    expect(updateExitCode).toBe(0);
    expect(updateChecks).toBe(0);
  });

  it('pins canonical CLI vocabulary in EN and KO usage documentation', () => {
    const documents = [
      'packages/cli/README.md',
      'packages/cli/README.ko.md',
      'apps/docs/content/docs/guides/cli.mdx',
      'apps/docs/content/docs/guides/cli.ko.mdx',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
    ].map((path) => readFileSync(join(repoRoot, path), 'utf8'));

    for (const document of documents) {
      expect(document).toContain('--dry-run');
    }

    for (const readme of documents.slice(0, 2)) {
      expect(readme).toContain('--with-slice-test');
      expect(readme).toContain('--no-update-check');
      expect(readme).not.toContain('--print-plan');
      expect(readme).not.toContain('--no-update-notifier');
    }

    for (const context of documents.slice(4)) {
      expect(context).toContain('injectable');
      expect(context).toContain('testing');
      expect(context).toContain('inject-params');
    }
  });
});
