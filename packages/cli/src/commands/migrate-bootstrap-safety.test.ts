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
  it('rewrites only the safe bootstrap when a callback bootstrap shares its NestFactory import', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const sourceFilePath = join(workspaceDirectory, 'src', 'main.ts');
    const callbackBootstrap = `async function bootstrapCallback() {
  const callbackApp = await NestFactory.create(CallbackModule);
  await callbackApp.listen(4000, () => {
    console.log('listening');
  });
}`;
    const source = `import { NestFactory } from '@nestjs/core';
import { CallbackModule } from './callback.module';
import { SafeModule } from './safe.module';

async function bootstrapSafe() {
  const safeApp = await NestFactory.create(SafeModule);
  await safeApp.listen(3000);
}

${callbackBootstrap}

void bootstrapSafe();
void bootstrapCallback();
`;
    writeFileSync(sourceFilePath, source);

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(
      ['./src', '--apply', '--platform', 'express', '--only', 'bootstrap', '--json'],
      {
        cwd: workspaceDirectory,
        stderr: { write: () => undefined },
        stdout: { write: (message) => stdoutBuffer.push(message) },
      },
    );

    // Then
    const report = JSON.parse(stdoutBuffer.join('')) as {
      changedFiles: number;
      warningCount: number;
      files: { filePath: string; warnings: { category: string }[] }[];
    };
    const transformed = readFileSync(sourceFilePath, 'utf8');
    expect(exitCode).toBe(0);
    expect(transformed).toContain('import { NestFactory } from \'@nestjs/core\';');
    expect(transformed).toMatch(
      /async function bootstrapCallback\(\) \{\s+const callbackApp = await NestFactory\.create\(CallbackModule\);\s+await callbackApp\.listen\(4000, \(\) => \{\s+console\.log\('listening'\);\s+\}\);\s+\}/,
    );
    expect(transformed).toContain('import { FluoFactory } from "@fluojs/runtime";');
    expect(transformed).toContain('adapter: createExpressAdapter({');
    expect(transformed).toMatch(/port:\s*3000/);
    expect(transformed).toContain('await safeApp.listen();');
    expect(transformed.match(/adapter: createExpressAdapter/g)).toHaveLength(1);
    expect(report.changedFiles).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.files).toContainEqual(
      expect.objectContaining({
        filePath: sourceFilePath,
        warnings: [expect.objectContaining({ category: 'bootstrap-port' })],
      }),
    );
  });

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

  it('preserves a cross-function shadowed app.listen binding', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const sourceFilePath = join(workspaceDirectory, 'src', 'main.ts');
    const source = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function createOnly() {
  const app = await NestFactory.create(AppModule);
  configure(app);
}

async function unrelatedServer(app: { listen(port: number): Promise<void> }) {
  await app.listen(3000);
}
`;
    writeFileSync(sourceFilePath, source);

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--platform', 'express', '--only', 'bootstrap', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    const report = JSON.parse(stdoutBuffer.join('')) as { changedFiles: number; warningCount: number };
    expect(exitCode).toBe(0);
    expect(readFileSync(sourceFilePath, 'utf8')).toBe(source);
    expect(report.changedFiles).toBe(0);
    expect(report.warningCount).toBe(1);
  });

  it('preserves reassigned and escaped bootstrap bindings', async () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    temporaryDirectories.push(workspaceDirectory);
    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const sourceFilePath = join(workspaceDirectory, 'src', 'main.ts');
    const source = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function reassigned() {
  let app = await NestFactory.create(AppModule);
  app = createUnrelatedServer();
  await app.listen(3000);
}

async function escaped() {
  const app = await NestFactory.create(AppModule);
  register(app);
  await app.listen(4000);
}
`;
    writeFileSync(sourceFilePath, source);

    // When
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--platform', 'express', '--only', 'bootstrap', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    // Then
    const report = JSON.parse(stdoutBuffer.join('')) as { changedFiles: number; warningCount: number };
    expect(exitCode).toBe(0);
    expect(readFileSync(sourceFilePath, 'utf8')).toBe(source);
    expect(report.changedFiles).toBe(0);
    expect(report.warningCount).toBe(2);
  });
});
