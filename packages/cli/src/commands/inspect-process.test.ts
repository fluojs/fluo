import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureModulePath = join(packageDirectory, 'src/fixtures/inspect-app.module.mjs');
const tsxImport = createRequire(import.meta.url).resolve('tsx');
const temporaryDirectories: string[] = [];
const mermaidSource = 'graph TD\n  PROCESS["components: 0"]';
const mermaidOutput = `${mermaidSource}\n`;

async function runInspectProcess(argv: readonly string[], injectRenderer = true): Promise<{
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const cliUrl = pathToFileURL(join(packageDirectory, 'src/cli.ts')).href;
  const command = [
    `const { runCli } = await import(${JSON.stringify(cliUrl)});`,
    `process.exitCode = await runCli(${JSON.stringify(['inspect', fixtureModulePath, ...argv])}, {`,
    '  updateCheck: false,',
    ...(injectRenderer ? [`  loadStudioMermaidRenderer: async () => () => ${JSON.stringify(mermaidSource)},`] : []),
    '});',
  ].join(' ');
  const child = spawn(process.execPath, ['--import', tsxImport, '--input-type=module', '--eval', command], {
    cwd: packageDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  return {
    exitCode,
    stderr: Buffer.concat(stderr).toString(),
    stdout: Buffer.concat(stdout).toString(),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('inspect Mermaid process output', () => {
  it('keeps Mermaid stdout free of bootstrap diagnostics', async () => {
    const result = await runInspectProcess(['--mermaid']);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(mermaidOutput);
    expect(result.stderr).not.toBe('');
  });

  it('writes Mermaid only to an explicit artifact while diagnostics stay on stderr', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluo-inspect-mermaid-'));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, 'artifacts', 'graph.mmd');
    const result = await runInspectProcess(['--mermaid', '--output', outputPath]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(outputPath, 'utf8')).toBe(mermaidOutput);
    expect(result.stderr).not.toBe('');
  });

  it('resolves the ESM-only Studio package entrypoint from a real process', async () => {
    const result = await runInspectProcess(['--mermaid'], false);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^graph TD\n/);
    expect(result.stderr).not.toBe('');
  });
});
