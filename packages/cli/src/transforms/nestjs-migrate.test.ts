import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATION_TRANSFORMS, runNestJsMigration } from './nestjs-migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createMigrationFixture(): string {
  const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-'));
  temporaryDirectories.push(workspaceDirectory);

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

  writeFileSync(
    join(workspaceDirectory, 'src', 'users.service.ts'),
    `import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class UsersService {}
`,
  );

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

  writeFileSync(
    join(workspaceDirectory, 'src', 'users.spec.ts'),
    `import { Test, type TestingModule } from '@nestjs/testing';
import { UsersModule } from './users.module';

describe('users', () => {
  it('works', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [UsersModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
`,
  );

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

  return workspaceDirectory;
}

describe('runNestJsMigration', () => {
  it('keeps files unchanged in dry-run mode while reporting planned changes', () => {
    const workspaceDirectory = createMigrationFixture();
    const beforeMain = readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8');

    const report = runNestJsMigration({
      apply: false,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });

    expect(report.scannedFiles).toBeGreaterThanOrEqual(5);
    expect(report.changedFiles).toBeGreaterThan(0);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8')).toBe(beforeMain);
  });

  it('applies safe transforms and keeps second run idempotent', () => {
    const workspaceDirectory = createMigrationFixture();

    const firstReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });

    const mainContent = readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8');
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'users.service.ts'), 'utf8');
    const testContent = readFileSync(join(workspaceDirectory, 'src', 'users.spec.ts'), 'utf8');
    const tsconfigContent = readFileSync(join(workspaceDirectory, 'tsconfig.json'), 'utf8');

    expect(firstReport.changedFiles).toBeGreaterThan(0);
    expect(mainContent).toContain("from \"@konekti/runtime\"");
    expect(mainContent).toMatch(/KonektiFactory\.create\(AppModule, \{[\s\S]*port:\s*3000[\s\S]*\}\)/);
    expect(mainContent).toContain('await app.listen();');
    expect(serviceContent).toMatch(/@Scope\(("|')request\1\)/);
    expect(serviceContent).not.toContain('@Injectable');
    expect(serviceContent).toContain("from \"@konekti/core\"");
    expect(testContent).toContain("from \"@konekti/testing\"");
    expect(testContent).toMatch(/createTestingModule\(\{[\s\S]*rootModule:\s*UsersModule[\s\S]*\}\)/);
    expect(testContent).not.toContain('Test.createTestingModule');
    expect(tsconfigContent).not.toContain('experimentalDecorators');
    expect(tsconfigContent).not.toContain('emitDecoratorMetadata');

    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });

    expect(secondReport.changedFiles).toBe(0);
  });

  it('supports --only/--skip equivalent transform filtering', () => {
    const workspaceDirectory = createMigrationFixture();

    runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['tsconfig']),
      targetPath: workspaceDirectory,
    });

    const mainContent = readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8');
    const tsconfigContent = readFileSync(join(workspaceDirectory, 'tsconfig.json'), 'utf8');

    expect(mainContent).toContain('NestFactory.create');
    expect(tsconfigContent).not.toContain('experimentalDecorators');
  });

  it('preserves listen(port) when port cannot be folded into create options', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'main.ts'),
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { port: 4000 });
  await app.listen(3000);
}

void bootstrap();
`,
    );

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['bootstrap']),
      targetPath: workspaceDirectory,
    });

    const mainContent = readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8');

    expect(mainContent).toContain('KonektiFactory.create(AppModule, { port: 4000 })');
    expect(mainContent).toContain('await app.listen(3000);');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unable to move listen() port argument'))).toBe(true);
  });

  it('skips bootstrap rewrite for unsupported NestFactory.create type arguments and adapter arguments', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'main.ts'),
      `import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());
  await app.listen(3000);
}

void bootstrap();
`,
    );

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['bootstrap']),
      targetPath: workspaceDirectory,
    });

    const mainContent = readFileSync(join(workspaceDirectory, 'src', 'main.ts'), 'utf8');

    expect(mainContent).toContain('NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter())');
    expect(mainContent).toContain('await app.listen(3000);');
    expect(mainContent).not.toContain('KonektiFactory.create');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unsupported NestFactory.create type-argument usage'))).toBe(true);
  });

  it('keeps unsupported Nest testing metadata unchanged and reports manual follow-up warning', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.spec.ts'),
      `import { Test, type TestingModule } from '@nestjs/testing';

describe('users', () => {
  it('works', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
`,
    );

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: workspaceDirectory,
    });

    const specContent = readFileSync(join(workspaceDirectory, 'src', 'users.spec.ts'), 'utf8');

    expect(specContent).toContain('Test.createTestingModule({');
    expect(specContent).toContain('providers: []');
    expect(specContent).not.toContain('from "@konekti/testing"');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unsupported Test.createTestingModule metadata shape'))).toBe(true);
  });

  it('skips testing rewrite for unsupported builder chains and reports warning', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'users.spec.ts'),
      `import { Test } from '@nestjs/testing';
import { UsersModule } from './users.module';

describe('users', () => {
  it('works', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UsersModule] })
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
`,
    );

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: workspaceDirectory,
    });

    const specContent = readFileSync(join(workspaceDirectory, 'src', 'users.spec.ts'), 'utf8');

    expect(specContent).toContain('Test.createTestingModule({ imports: [UsersModule] })');
    expect(specContent).toContain('.useMocker(() => ({}))');
    expect(specContent).not.toContain('createTestingModule({ rootModule: UsersModule })');
    expect(specContent).not.toContain('from "@konekti/testing"');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unsupported testing builder method "useMocker"'))).toBe(true);
  });

  it('applies scope mapping when only scope transform is enabled', () => {
    const workspaceDirectory = createMigrationFixture();

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['scope']),
      targetPath: workspaceDirectory,
    });

    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'users.service.ts'), 'utf8');

    expect(report.changedFiles).toBeGreaterThan(0);
    expect(serviceContent).toContain('@Injectable({ scope: Scope.REQUEST })');
    expect(serviceContent).toMatch(/@KonektiScope\(("|')request\1\)/);
    expect(serviceContent).toContain("import { Injectable");
    expect(serviceContent).toContain('import { Scope as KonektiScope } from "@konekti/core";');

    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['scope']),
      targetPath: workspaceDirectory,
    });

    expect(secondReport.changedFiles).toBe(0);
  });
});
