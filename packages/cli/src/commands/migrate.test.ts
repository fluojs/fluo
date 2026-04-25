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
  it('keeps invalid option errors on stderr without JSON stdout', async () => {
    const stderrBuffer: string[] = [];
    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--json', '--unknown'], {
      cwd: process.cwd(),
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(stdoutBuffer.join('')).toBe('');
    expect(stderrBuffer.join('')).toContain('Unknown option for migrate command: --unknown');
  });

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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
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

  it('emits structured JSON summary in dry-run mode', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    const sourceFilePath = join(workspaceDirectory, 'src', 'main.ts');
    writeFileSync(
      sourceFilePath,
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
    const exitCode = await runMigrateCommand(['./src', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: (message) => stderrBuffer.push(message) },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    const report = JSON.parse(output) as {
      apply: boolean;
      changedFiles: number;
      command: string;
      dryRun: boolean;
      files: { appliedTransforms: string[]; changed: boolean; filePath: string; warningCount: number; warnings: unknown[] }[];
      mode: string;
      scannedFiles: number;
      transforms: string[];
      warningCount: number;
    };

    expect(exitCode).toBe(0);
    expect(stderrBuffer.join('')).toBe('');
    expect(output).not.toContain('Mode: dry-run');
    expect(report).toMatchObject({
      apply: false,
      changedFiles: 1,
      command: 'migrate',
      dryRun: true,
      mode: 'dry-run',
      scannedFiles: 1,
      warningCount: 0,
    });
    expect(report.transforms).toContain('bootstrap');
    expect(report.files).toEqual([
      {
        appliedTransforms: ['bootstrap'],
        changed: true,
        filePath: sourceFilePath,
        warningCount: 0,
        warnings: [],
      },
    ]);
  });

  it('emits structured JSON summary in apply mode', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'app.controller.ts'),
      `import { Controller, Inject } from '@nestjs/common';

@Controller('app')
export class AppController {
  constructor(@Inject('SVC') private readonly svc: unknown) {}
}
`,
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply', '--json'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const report = JSON.parse(stdoutBuffer.join('')) as {
      apply: boolean;
      changedFiles: number;
      dryRun: boolean;
      files: { warningCount: number; warnings: { category: string; categoryLabel: string; line: number; message: string }[] }[];
      mode: string;
      warningCount: number;
    };

    expect(exitCode).toBe(0);
    expect(report.apply).toBe(true);
    expect(report.dryRun).toBe(false);
    expect(report.mode).toBe('apply');
    expect(report.changedFiles).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.files[0]?.warningCount).toBe(1);
    expect(report.files[0]?.warnings[0]).toMatchObject({
      category: 'inject-token',
      categoryLabel: 'DI token migration (@Inject)',
      line: 5,
      message: 'Constructor @Inject(TOKEN) parameter decorators need manual migration to class-level @Inject(TOKEN, ...) syntax.',
    });
  });

  it('outputs "Automated rewrites:" section header for changed files', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
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
    const exitCode = await runMigrateCommand(['./src', '--apply'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('Automated rewrites:');
    expect(output).not.toContain('Changed file(s):');
  });

  it('groups manual follow-up warnings by category with label headers', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.controller.ts'),
      `import { Body, Controller, Post, UsePipes, ValidationPipe, Inject } from '@nestjs/common';

@Controller('users')
export class UsersController {
  constructor(@Inject('TOKEN') private readonly token: string) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() body: unknown) {
    return body;
  }
}
`,
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('Manual follow-up required:');
    expect(output).toMatch(/\[DI token migration \(@Inject\)\]/);
    expect(output).toContain('Docs: https://github.com/fluojs/fluo');
    expect(output).toContain('post-codemod checklist');
  });

  it('outputs clean-run message when no warnings are produced', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            strict: true,
          },
        },
        null,
        2,
      )}\n`,
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['.', '--apply', '--only', 'tsconfig'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('All transforms applied cleanly. No manual follow-ups detected.');
  });

  it('outputs docs link when warnings are present', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-command-'));
    tempDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'app.controller.ts'),
      `import { Controller, Inject } from '@nestjs/common';

@Controller('app')
export class AppController {
  constructor(@Inject('SVC') private readonly svc: unknown) {}
}
`,
    );

    const stdoutBuffer: string[] = [];
    const exitCode = await runMigrateCommand(['./src', '--apply'], {
      cwd: workspaceDirectory,
      stderr: { write: () => undefined },
      stdout: { write: (message) => stdoutBuffer.push(message) },
    });

    const output = stdoutBuffer.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/migrate-from-nestjs.md');
    expect(output).toContain('Use the post-codemod checklist in the migration guide to address each warning category.');
  });
});
