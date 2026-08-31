import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getWarningCategoryLabel,
  groupWarningsByCategory,
  MIGRATION_TRANSFORMS,
  type MigrationWarning,
  runNestJsMigration,
  WARNING_CATEGORIES,
} from './nestjs-migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createMigrationFixture(): string {
  const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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
          baseUrl: 'src',
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
          paths: {
            '@app/*': ['app/*'],
            '@health': ['./health/health.module.ts'],
          },
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
    const tsconfig = JSON.parse(tsconfigContent) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };

    expect(firstReport.changedFiles).toBeGreaterThan(0);
    expect(mainContent).toContain("from \"@fluojs/runtime\"");
    expect(mainContent).toMatch(/FluoFactory\.create\(AppModule, \{[\s\S]*port:\s*3000[\s\S]*\}\)/);
    expect(mainContent).toContain('await app.listen();');
    expect(serviceContent).toMatch(/@Scope\(("|')request\1\)/);
    expect(serviceContent).not.toContain('@Injectable');
    expect(serviceContent).toContain("from \"@fluojs/core\"");
    expect(testContent).toContain("from \"@fluojs/testing\"");
    expect(testContent).toMatch(/createTestingModule\(\{[\s\S]*rootModule:\s*UsersModule[\s\S]*\}\)/);
    expect(testContent).not.toContain('Test.createTestingModule');
    expect(tsconfigContent).not.toContain('experimentalDecorators');
    expect(tsconfigContent).not.toContain('emitDecoratorMetadata');
    expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
    expect(tsconfig.compilerOptions?.paths).toEqual({
      '@app/*': ['src/app/*'],
      '@health': ['src/health/health.module.ts'],
    });

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
    const tsconfig = JSON.parse(tsconfigContent) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };

    expect(mainContent).toContain('NestFactory.create');
    expect(tsconfigContent).not.toContain('experimentalDecorators');
    expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
    expect(tsconfig.compilerOptions?.paths).toEqual({
      '@app/*': ['src/app/*'],
      '@health': ['src/health/health.module.ts'],
    });
  });

  it('preserves listen(port) when port cannot be folded into create options', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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

    expect(mainContent).toContain('FluoFactory.create(AppModule, { port: 4000 })');
    expect(mainContent).toContain('await app.listen(3000);');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unable to move listen() port argument'))).toBe(true);
  });

  it('skips bootstrap rewrite for unsupported NestFactory.create type arguments and adapter arguments', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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
    expect(mainContent).not.toContain('FluoFactory.create');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unsupported NestFactory.create type-argument usage'))).toBe(true);
  });

  it('keeps unsupported Nest testing metadata unchanged and reports manual follow-up warning', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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
    expect(specContent).not.toContain('from "@fluojs/testing"');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.message.includes('Unsupported Test.createTestingModule metadata shape'))).toBe(true);
  });

  it('skips testing rewrite for unsupported builder chains and reports warning', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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
    expect(specContent).not.toContain('from "@fluojs/testing"');
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
    expect(serviceContent).toMatch(/@FluoScope\(("|')request\1\)/);
    expect(serviceContent).toContain("import { Injectable");
    expect(serviceContent).toContain('import { Scope as FluoScope } from "@fluojs/core";');

    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['scope']),
      targetPath: workspaceDirectory,
    });

    expect(secondReport.changedFiles).toBe(0);
  });

  it('converts every constructor dependency to an ordered class-level Inject tuple', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'three-dependencies.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';

class SecondaryDependency {}
const PRIMARY_TOKEN = Symbol('primary');
const TERTIARY_TOKEN = Symbol('tertiary');

@Injectable()
export class ThreeDependenciesService {
  constructor(
    @Inject(PRIMARY_TOKEN) private readonly primary: string,
    private readonly secondary: SecondaryDependency,
    @Inject(TERTIARY_TOKEN) private readonly tertiary: string,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'three-dependencies.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(PRIMARY_TOKEN, SecondaryDependency, TERTIARY_TOKEN)');
    expect(serviceContent).not.toContain('constructor(@Inject');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token')).toBe(false);
  });

  it('migrates Nest Inject from an overloaded constructor implementation', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'overloaded-constructor.service.ts'),
      `import { Inject as NestInject } from '@nestjs/common';

const TOKEN = Symbol('token');

export class OverloadedConstructorService {
  constructor(token: string);
  constructor(@NestInject(TOKEN) private readonly token: string) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'overloaded-constructor.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('import { Inject as NestInject } from "@fluojs/core";');
    expect(serviceContent).toContain('@NestInject(TOKEN)');
    expect(serviceContent).not.toContain('constructor(@NestInject');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token')).toBe(false);
  });

  it('merges existing Fluo Inject tokens with migrated Nest Inject tokens', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'partially-migrated.service.ts'),
      `import { Inject as FluoInject } from '@fluojs/core';
import { Inject as NestInject } from '@nestjs/common';

const A_TOKEN = Symbol('a');
const B_TOKEN = Symbol('b');

@FluoInject(A_TOKEN)
export class PartiallyMigratedService {
  constructor(
    private readonly existing: object,
    @NestInject(B_TOKEN) private readonly dependency: string,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'partially-migrated.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@FluoInject(A_TOKEN, B_TOKEN)');
    expect(serviceContent.match(/@FluoInject\(/g)).toHaveLength(1);
    expect(serviceContent).not.toContain('@NestInject(');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token')).toBe(false);
  });

  it('merges Nest Inject tokens into an existing namespace Fluo Inject decorator', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'namespace-decorator.service.ts'),
      `import * as Core from '@fluojs/core';
import { Inject as NestInject } from '@nestjs/common';

const A_TOKEN = Symbol('a');
const B_TOKEN = Symbol('b');

@Core.Inject(A_TOKEN)
export class NamespaceDecoratorService {
  constructor(
    private readonly existing: object,
    @NestInject(B_TOKEN) private readonly dependency: string,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'namespace-decorator.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Core.Inject(A_TOKEN, B_TOKEN)');
    expect(serviceContent.match(/@Core\.Inject\(/g)).toHaveLength(1);
    expect(serviceContent).not.toContain('@NestInject(');
    expect(report.warningCount).toBe(0);
  });

  it('normalizes legacy Fluo Inject arrays while replacing converted token positions', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'legacy-array-decorator.service.ts'),
      `import { Inject as FluoInject } from '@fluojs/core';
import { Inject as NestInject } from '@nestjs/common';

const A_TOKEN = Symbol('a');
const B_TOKEN = Symbol('b');

@FluoInject([A_TOKEN])
export class LegacyArrayDecoratorService {
  constructor(
    private readonly existing: object,
    @NestInject(B_TOKEN) private readonly dependency: string,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'legacy-array-decorator.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@FluoInject(A_TOKEN, B_TOKEN)');
    expect(serviceContent).not.toContain('@FluoInject([');
    expect(serviceContent.match(/@FluoInject\(/g)).toHaveLength(1);
    expect(report.warningCount).toBe(0);
  });

  it('reports injectable when constructor token rewriting is the only change', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'constructor-only.service.ts'),
      `import { Inject } from '@nestjs/common';

const TOKEN = Symbol('token');

export class ConstructorOnlyService {
  constructor(@Inject(TOKEN) private readonly dependency: string) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['injectable']),
      targetPath: workspaceDirectory,
    });

    // Then
    expect(report.fileResults[0]?.appliedTransforms).toEqual(['injectable']);
  });

  it('retains constructor injection when a type name collides with a runtime value', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'colliding-dependency.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';

const TOKEN = Symbol('token');
const Dependency = Symbol('wrong-token');
interface Dependency {
  readonly id: string;
}

@Injectable()
export class CollidingDependencyService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: Dependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'colliding-dependency.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).not.toContain('@Inject(TOKEN, Dependency)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructor injection when an imported type collides with a runtime value', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'imported-type-collision.service.ts'),
      `import type { Dependency } from './types';
import { Inject } from '@nestjs/common';

const TOKEN = Symbol('token');
const Dependency = Symbol('wrong-token');

export class ImportedTypeCollisionService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: Dependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'imported-type-collision.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).not.toContain('@Inject(TOKEN, Dependency)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructor injection when a class type parameter collides with a runtime value', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'generic-type-parameter-collision.service.ts'),
      `import { Inject } from '@nestjs/common';

const TOKEN = Symbol('token');
const Dependency = Symbol('wrong-token');

class Consumer<Dependency> {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: Dependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'generic-type-parameter-collision.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).not.toContain('@Inject(TOKEN, Dependency)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('rewrites generated Inject imports when only injectable is enabled', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'injectable-only.service.ts'),
      `import { Inject } from '@nestjs/common';

const TOKEN = Symbol('token');

export class InjectableOnlyService {
  constructor(@Inject(TOKEN) private readonly dependency: string) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['injectable']),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'injectable-only.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('import { Inject } from "@fluojs/core";');
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).not.toContain('@nestjs/common');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token')).toBe(false);
  });

  it('adds a named Fluo Inject import alongside a namespace core import', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'namespace-core-import.service.ts'),
      `import * as Core from '@fluojs/core';
import { Inject } from '@nestjs/common';

const TOKEN = Symbol('token');

export class NamespaceCoreImportService {
  constructor(@Inject(TOKEN) private readonly dependency: string) {}
}

void Core;
`,
    );

    // When
    runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'namespace-core-import.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('import * as Core from \'@fluojs/core\';');
    expect(serviceContent).toContain('import { Inject } from "@fluojs/core";');
    expect(serviceContent).toContain('@Inject(TOKEN)');
  });

  it('converts safe constructors while retaining unsafe constructors with diagnostics', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'mixed-constructor-safety.service.ts'),
      `import { Inject } from '@nestjs/common';

const SAFE_TOKEN = Symbol('safe');
const UNSAFE_TOKEN = Symbol('unsafe');

export class SafeConstructorService {
  constructor(@Inject(SAFE_TOKEN) private readonly dependency: string) {}
}

export class UnsafeConstructorService {
  constructor(
    @Inject(UNSAFE_TOKEN) private readonly dependency: string,
    ...remaining: readonly unknown[]
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'mixed-constructor-safety.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('import { Inject as FluoInject } from "@fluojs/core";');
    expect(serviceContent).toContain("import { Inject } from '@nestjs/common';");
    expect(serviceContent).toContain('@FluoInject(SAFE_TOKEN)');
    expect(serviceContent).toContain('@Inject(UNSAFE_TOKEN)');
    expect(serviceContent).toContain('...remaining: readonly unknown[]');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains unsafe constructor dependencies and reports an unsupported inject-token diagnostic', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'unsafe-dependencies.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';

const PRIMARY_TOKEN = Symbol('primary');

@Injectable()
export class UnsafeDependenciesService {
  constructor(
    @Inject(PRIMARY_TOKEN) private readonly primary: string,
    private readonly secondary: SecondaryDependency,
    ...remaining: readonly RemainingDependency[]
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'unsafe-dependencies.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(PRIMARY_TOKEN)');
    expect(serviceContent).toContain('...remaining: readonly RemainingDependency[]');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructors that infer a token from an unresolved value import', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'unresolved-import.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';
import { ImportedDependency } from './dependencies';

const TOKEN = Symbol('token');

@Injectable()
export class UnresolvedImportService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: ImportedDependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'unresolved-import.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain("import { Inject } from '@nestjs/common';");
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructors that infer a token from an import type', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'import-type.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';
import type { ImportedDependency } from './dependencies';

const TOKEN = Symbol('token');

@Injectable()
export class ImportTypeService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: ImportedDependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'import-type.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain("import { Inject } from '@nestjs/common';");
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructors that infer a token from an interface', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'interface.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';

interface InterfaceDependency {}
const TOKEN = Symbol('token');

@Injectable()
export class InterfaceService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: InterfaceDependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'interface.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).toContain('dependency: InterfaceDependency');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('retains constructors that infer a token from a type alias', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'type-alias.service.ts'),
      `import { Inject, Injectable } from '@nestjs/common';

type AliasDependency = { readonly id: string };
const TOKEN = Symbol('token');

@Injectable()
export class TypeAliasService {
  constructor(
    @Inject(TOKEN) private readonly token: string,
    private readonly dependency: AliasDependency,
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'type-alias.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('@Inject(TOKEN)');
    expect(serviceContent).toContain('dependency: AliasDependency');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('converts a safe aliased Nest Inject decorator', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'aliased-inject.service.ts'),
      `import { Inject as NestInject, Injectable } from '@nestjs/common';

const TOKEN = Symbol('token');
class RuntimeDependency {}

@Injectable()
export class AliasedInjectService {
  constructor(
    @NestInject(TOKEN) private readonly token: string,
    private readonly dependency: RuntimeDependency,
  ) {}
}
`,
    );

    // When
    runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'aliased-inject.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain('import { Inject as NestInject } from "@fluojs/core";');
    expect(serviceContent).toContain('@NestInject(TOKEN, RuntimeDependency)');
  });

  it('retains unsafe aliased Nest Inject decorators with a diagnostic', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'unsafe-aliased-inject.service.ts'),
      `import { Inject as NestInject, Injectable } from '@nestjs/common';

const TOKEN = Symbol('token');

@Injectable()
export class UnsafeAliasedInjectService {
  constructor(
    @NestInject(TOKEN) private readonly token: string,
    private readonly dependency: Dependency,
    ...remaining: readonly RemainingDependency[]
  ) {}
}
`,
    );

    // When
    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'unsafe-aliased-inject.service.ts'), 'utf8');

    // Then
    expect(serviceContent).toContain("import { Inject as NestInject } from '@nestjs/common';");
    expect(serviceContent).toContain('@NestInject(TOKEN)');
    expect(report.fileResults.flatMap((result) => result.warnings).some((warning) => warning.category === 'inject-token-unsupported')).toBe(true);
  });

  it('emits a runtime Inject binding separately from type-only core imports', () => {
    // Given
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
    temporaryDirectories.push(workspaceDirectory);

    mkdirSync(join(workspaceDirectory, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceDirectory, 'src', 'type-only-core-import.service.ts'),
      `import type { InjectionToken } from '@fluojs/core';
import { Inject as NestInject, Injectable } from '@nestjs/common';

const TOKEN = Symbol('token');
class RuntimeDependency {}
type RuntimeMarker = InjectionToken;

@Injectable()
export class TypeOnlyCoreImportService {
  constructor(
    @NestInject(TOKEN) private readonly token: string,
    private readonly dependency: RuntimeDependency,
  ) {}
}
`,
    );

    // When
    runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });
    const serviceContent = readFileSync(join(workspaceDirectory, 'src', 'type-only-core-import.service.ts'), 'utf8');
    const emitted = ts.transpileModule(serviceContent, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });

    // Then
    expect(serviceContent).toContain("import type { InjectionToken } from '@fluojs/core';");
    expect(serviceContent).toContain('import { Inject as NestInject } from "@fluojs/core";');
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.outputText).toContain('NestInject(TOKEN, RuntimeDependency)');
  });

  it('attaches correct warning categories to each warning type', () => {
    const workspaceDirectory = createMigrationFixture();

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: workspaceDirectory,
    });

    const allWarnings = report.fileResults.flatMap((result) => result.warnings);

    expect(allWarnings.length).toBeGreaterThan(0);

    for (const warning of allWarnings) {
      expect(WARNING_CATEGORIES).toContain(warning.category);
      expect(warning.category).toBeTruthy();
    }

    const categories = new Set(allWarnings.map((w) => w.category));
    expect(categories.has('inject-token-unsupported')).toBe(false);
    expect(categories.has('request-dto')).toBe(true);
    expect(categories.has('pipe-converter')).toBe(true);
  });

  it('attaches bootstrap-unsupported category to unsupported NestFactory.create variants', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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

    const allWarnings = report.fileResults.flatMap((result) => result.warnings);
    const bootstrapWarnings = allWarnings.filter((w) => w.category === 'bootstrap-unsupported');
    expect(bootstrapWarnings.length).toBeGreaterThan(0);
  });

  it('attaches bootstrap-port category when listen port cannot be folded', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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

    const allWarnings = report.fileResults.flatMap((result) => result.warnings);
    const portWarnings = allWarnings.filter((w) => w.category === 'bootstrap-port');
    expect(portWarnings.length).toBeGreaterThan(0);
  });

  it('attaches testing-unsupported category to unsupported testing patterns', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-'));
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

    const allWarnings = report.fileResults.flatMap((result) => result.warnings);
    const testingWarnings = allWarnings.filter((w) => w.category === 'testing-unsupported');
    expect(testingWarnings.length).toBeGreaterThan(0);
  });
});

describe('getWarningCategoryLabel', () => {
  it('returns human-readable labels for all warning categories', () => {
    for (const category of WARNING_CATEGORIES) {
      const label = getWarningCategoryLabel(category);
      expect(label).toBeTruthy();
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('returns expected label for inject-token category', () => {
    expect(getWarningCategoryLabel('inject-token')).toBe('DI token migration (@Inject)');
  });

  it('returns expected label for bootstrap-unsupported category', () => {
    expect(getWarningCategoryLabel('bootstrap-unsupported')).toBe('Unsupported bootstrap variant');
  });
});

describe('groupWarningsByCategory', () => {
  it('groups warnings by their category field', () => {
    const warnings: MigrationWarning[] = [
      { category: 'inject-token', filePath: 'a.ts', line: 1, message: 'msg1' },
      { category: 'inject-token', filePath: 'b.ts', line: 2, message: 'msg2' },
      { category: 'request-dto', filePath: 'c.ts', line: 3, message: 'msg3' },
      { category: 'pipe-converter', filePath: 'd.ts', line: 4, message: 'msg4' },
    ];

    const grouped = groupWarningsByCategory(warnings);

    expect(grouped.size).toBe(3);
    expect(grouped.get('inject-token')).toHaveLength(2);
    expect(grouped.get('request-dto')).toHaveLength(1);
    expect(grouped.get('pipe-converter')).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    const grouped = groupWarningsByCategory([]);
    expect(grouped.size).toBe(0);
  });

  it('preserves warning order within each group', () => {
    const warnings: MigrationWarning[] = [
      { category: 'inject-token', filePath: 'first.ts', line: 1, message: 'first' },
      { category: 'inject-token', filePath: 'second.ts', line: 2, message: 'second' },
    ];

    const grouped = groupWarningsByCategory(warnings);
    const group = grouped.get('inject-token')!;
    expect(group[0].filePath).toBe('first.ts');
    expect(group[1].filePath).toBe('second.ts');
  });
});
