import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS config migration documentation', () => {
  it('maps the source-backed ConfigModule registration contract in both locales', () => {
    // Given
    const moduleSource = read('packages/config/src/module.ts');
    const typesSource = read('packages/config/src/types.ts');
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    expect(moduleSource).toContain('static forRoot(options?: ConfigModuleOptions)');
    expect(moduleSource).toContain('global: loadOptions.global ?? true');
    expect(typesSource).toContain('processEnv?: NodeJS.ProcessEnv');
    expect(typesSource).toContain('schema?: ConfigSchema');
    expect(typesSource).toContain('global?: boolean');

    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain('@nestjs/config');
      expect(migrationDoc).toContain('ConfigModule.forRoot(...)');
      expect(migrationDoc).toContain('processEnv');
      expect(migrationDoc).toContain('Standard Schema');
      expect(migrationDoc).toContain('global?: boolean');
      expect(migrationDoc).toContain('FluoFactory.create(AppModule, { adapter })');
    }
  });

  it('keeps adapter-first bootstrap explicit in the bilingual config chapter', () => {
    // Given
    const englishChapter = read('book/beginner/ch11-config.md');
    const koreanChapter = read('book/beginner/ch11-config.ko.md');

    // When
    const chapters = [englishChapter, koreanChapter] as const;

    // Then
    for (const chapter of chapters) {
      expect(chapter).toContain("import { createFastifyAdapter } from '@fluojs/platform-fastify';");
      expect(chapter).toContain('adapter: createFastifyAdapter({ port })');
      expect(chapter).toContain('await app.listen();');
      expect(chapter).not.toContain('const app = await FluoFactory.create(AppModule);');
      expect(chapter).not.toContain('await app.listen(port);');
    }
  });

  it('keeps the config migration boundary discoverable from both context indexes', () => {
    // Given
    const englishContext = read('docs/CONTEXT.md');
    const koreanContext = read('docs/CONTEXT.ko.md');

    // When
    const contextDocs = [englishContext, koreanContext] as const;

    // Then
    for (const contextDoc of contextDocs) {
      expect(contextDoc).toContain('@nestjs/config');
      expect(contextDoc).toContain('book/beginner/ch11-config');
      expect(contextDoc).toContain('ConfigModule.forRoot(...)');
      expect(contextDoc).toContain('processEnv');
      expect(contextDoc).toContain('adapter-first');
    }
  });

  it('passes the executable platform governance guard', () => {
    // Given
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('reports the governed file and markers when a contract surface drifts', () => {
    // Given
    const readWithoutConfigModule = (relativePath: string): string =>
      relativePath === 'packages/config/src/module.ts' ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutConfigModule);

    // Then
    expect(runGovernanceGuard).toThrow(/packages\/config\/src\/module\.ts.*static forRoot/);
  });
});
