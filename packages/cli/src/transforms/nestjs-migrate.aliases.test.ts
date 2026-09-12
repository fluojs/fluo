import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runNestJsMigration } from './nestjs-migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(source: string): string {
  const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-migrate-aliases-'));
  temporaryDirectories.push(workspaceDirectory);
  const sourceFilePath = join(workspaceDirectory, 'users.spec.ts');
  writeFileSync(sourceFilePath, source);
  return sourceFilePath;
}

describe('runNestJsMigration testing aliases', () => {
  it('rewrites each supported Nest Test alias without capture from a nested shadow', () => {
    // Given
    const sourceFilePath = createFixture(`import { Test as FirstTest, Test as SecondTest } from '@nestjs/testing';
import { Test as ExistingFluoTest } from '@fluojs/testing';
import { UsersModule } from './users.module';

const firstModule = await FirstTest.createTestingModule({ imports: [UsersModule] }).compile();

async function createSecondModule(FirstTest: unknown) {
  const secondModule = await SecondTest.createTestingModule({ imports: [UsersModule] }).compile();
  const existingModule = await ExistingFluoTest.createTestingModule({ rootModule: UsersModule }).compile();
  return [FirstTest, secondModule, existingModule];
}

void [firstModule, createSecondModule];
`);

    // When
    const firstReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: sourceFilePath,
    });
    const migratedSource = readFileSync(sourceFilePath, 'utf8');
    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: sourceFilePath,
    });

    // Then
    expect(firstReport.warningCount).toBe(0);
    expect(migratedSource).toMatch(/import \{ Test as ExistingFluoTest, Test as FluoTest \} from ['"]@fluojs\/testing['"];/);
    expect(migratedSource).not.toContain('@nestjs/testing');
    expect(migratedSource).toContain('FluoTest.createTestingModule({');
    expect(migratedSource).toContain('rootModule: UsersModule');
    expect(migratedSource).not.toContain('FirstTest.createTestingModule');
    expect(migratedSource).toContain('const existingModule = await ExistingFluoTest.createTestingModule');
    expect(secondReport.changedFiles).toBe(0);
  });

  it('retains the exact Nest alias with an unsupported chain while converting other aliases', () => {
    // Given
    const sourceFilePath = createFixture(`import { Test as SupportedTest, Test as UnsupportedTest } from '@nestjs/testing';
import { Test as ExistingFluoTest } from '@fluojs/testing';
import { UsersModule } from './users.module';

const unsupportedModule = await UnsupportedTest.createTestingModule({ providers: [] }).compile();

async function createSupportedModule(FluoTest: unknown) {
  const supportedModule = await SupportedTest.createTestingModule({ imports: [UsersModule] }).compile();
  const existingModule = await ExistingFluoTest.createTestingModule({ rootModule: UsersModule }).compile();
  return [FluoTest, supportedModule, existingModule];
}

void [unsupportedModule, createSupportedModule];
`);

    // When
    const firstReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: sourceFilePath,
    });
    const migratedSource = readFileSync(sourceFilePath, 'utf8');
    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(['testing']),
      targetPath: sourceFilePath,
    });

    // Then
    expect(firstReport.warningCount).toBe(1);
    expect(migratedSource).toMatch(/import \{ Test as UnsupportedTest \} from ['"]@nestjs\/testing['"];/);
    expect(migratedSource).toMatch(/import \{ Test as ExistingFluoTest, Test as FluoTest2 \} from ['"]@fluojs\/testing['"];/);
    expect(migratedSource).toContain('FluoTest2.createTestingModule({');
    expect(migratedSource).toContain('UnsupportedTest.createTestingModule({ providers: [] }).compile()');
    expect(secondReport.changedFiles).toBe(0);
  });
});
