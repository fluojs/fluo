import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runMigrateCommand } from './migrate.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('runMigrateCommand', () => {
  it('rejects unknown transform names in --only', async () => {
    const stderrBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--only', 'unknown'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('Unknown transform(s): unknown');
  });

  it('rejects empty transform selections after --only/--skip filtering', async () => {
    const stderrBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--only', 'imports', '--skip', 'imports'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: () => undefined },
    });

    expect(exitCode).toBe(1);
    expect(stderrBuffer.join('')).toContain('No transforms remain');
  });

  it('returns changed file summary in dry-run mode', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

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

    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(stdoutBuffer.join('')).toContain('Mode: dry-run');
    expect(stdoutBuffer.join('')).toContain('Changed files: 1');
    expect(stdoutBuffer.join('')).toContain('Run again with --apply to write transformed files.');
  });
});
