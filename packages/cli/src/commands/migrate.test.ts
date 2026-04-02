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

  it('outputs "Automated rewrites:" section header for changed files', async () => {
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-command-'));
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
    expect(output).toContain('Docs: https://github.com/konektijs/konekti');
    expect(output).toContain('post-codemod checklist');
  });

  it('outputs clean-run message when no warnings are produced', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-command-'));
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
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-command-'));
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
    expect(output).toContain('Docs: https://github.com/konektijs/konekti/tree/main/docs/getting-started/migrate-from-nestjs.md');
    expect(output).toContain('Use the post-codemod checklist in the migration guide to address each warning category.');
  });
});
