import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runMigrateCommand } from './migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('migrate bootstrap safety boundary', () => {
  it('preserves a Nest callback listen bootstrap and reports manual migration', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const sourceFilePath = join(workspaceDirectory, 'src', 'main.ts');
    const source = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000, () => {
    console.log('listening');
  });
}
void bootstrap();
`;
    writeFileSync(sourceFilePath, source);

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--platform', 'express', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    const report = JSON.parse(stdoutBuffer.join('')) as {
      changedFiles: number;
      warningCount: number;
      files: { filePath: string; warnings: { category: string }[] }[];
    };
    expect(exitCode).toBe(0);
    expect(readFileSync(sourceFilePath, 'utf8')).toBe(source);
    expect(report.changedFiles).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.files).toContainEqual(
      expect.objectContaining({
        filePath: sourceFilePath,
        warnings: [expect.objectContaining({ category: 'bootstrap-port' })],
      }),
    );
  });
});
