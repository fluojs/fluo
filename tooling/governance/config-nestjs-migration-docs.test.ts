import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';

import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS config migration documentation', () => {
  it('maps the source-backed ConfigModule registration contract in both locales', () => {
    // Given
    const loadSource = read('packages/config/src/load.ts');
    const moduleSource = read('packages/config/src/module.ts');
    const serviceSource = read('packages/config/src/service.ts');
    const typesSource = read('packages/config/src/types.ts');
    const runtimeSource = read('packages/runtime/src/bootstrap.ts');
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    expect(loadSource).toContain('mergeConfigEntries(targetValue, sourceValue);');
    expect(loadSource).toContain('options.safeProcessEnv');
    expect(loadSource).toContain('return validateConfig(options, buildMergedConfig(options));');
    expect(moduleSource).toContain('static forRoot(options?: ConfigModuleOptions)');
    expect(moduleSource).toContain('global: loadOptions.global ?? true');
    expect(serviceSource).toContain("const parts = key.split('.');");
    expect(typesSource).toContain('processEnv?: NodeJS.ProcessEnv');
    expect(typesSource).toContain('schema?: ConfigSchema');
    expect(typesSource).toContain('global?: boolean');
    expect(runtimeSource).toContain('const hasHttpAdapter = effectiveOptions.adapter !== undefined;');
    expect(runtimeSource).toContain('Application cannot listen without an HTTP adapter.');

    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain('@nestjs/config');
      expect(migrationDoc).toContain('ConfigModule.forRoot(...)');
      expect(migrationDoc).toContain('processEnv');
      expect(migrationDoc).toContain('Standard Schema');
      expect(migrationDoc).toContain('global?: boolean');
      expect(migrationDoc).toContain('FluoFactory.create(AppModule, { adapter })');
      expect(migrationDoc).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(migrationDoc).toContain("ConfigService.get('http.port')");
      expect(migrationDoc).not.toContain('flatten namespaced');
      expect(migrationDoc).not.toContain('namespaced result to flatten');
    }
  });

  it('uses one validated nested snapshot for module registration and the HTTP adapter', () => {
    // Given
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    for (const migrationDoc of migrationDocs) {
      const configSection = migrationDoc.slice(migrationDoc.indexOf('### NestJS Config'));
      const codeFence = configSection.match(/```typescript\n([\s\S]*?)```/)?.[1];

      expect(codeFence).toBeDefined();
      expect(codeFence).toContain('const namespacedDefaults = await loadNamespacedConfig();');
      expect(codeFence).toContain('defaults: namespacedDefaults');
      expect(codeFence).toContain('const validatedConfig = ConfigSchema.parse(loadConfig(configSources));');
      expect(codeFence).toContain('defaults: validatedConfig');
      expect(codeFence).toContain('schema: ConfigSchema');
      expect(codeFence).toContain('port: validatedConfig.http.port');
      expect(codeFence).not.toContain('ConfigSchema.parse(processEnv)');
      expect(codeFence?.match(/process\.env\.PORT/g)).toHaveLength(1);
      expect(transpileModule(codeFence ?? '', {
        compilerOptions: {
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      }).diagnostics).toEqual([]);
    }
  });

  it('keeps the listen-only adapter boundary explicit in the bilingual config chapter', () => {
    // Given
    const englishChapter = read('book/beginner/ch11-config.md');
    const koreanChapter = read('book/beginner/ch11-config.ko.md');

    // When
    const chapters = [englishChapter, koreanChapter] as const;

    // Then
    for (const chapter of chapters) {
      expect(chapter).toContain("import { createFastifyAdapter } from '@fluojs/platform-fastify';");
      expect(chapter).toContain('adapter: createFastifyAdapter({ port: validatedConfig.PORT })');
      expect(chapter).toContain('await app.listen();');
      expect(chapter).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(chapter).toContain('defaults: validatedConfig');
      expect(chapter).toContain('schema: ConfigSchema');
      expect(chapter).not.toContain('await app.listen(port);');
      expect(chapter).not.toContain('.parse(process.env.PORT)');
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
      expect(contextDoc).toContain('FluoFactory.createApplicationContext(AppModule)');
      expect(contextDoc).toContain('plain-object deep merge');
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

  it.each([
    ['packages/config/src/load.ts', 'mergeConfigEntries(targetValue, sourceValue);'],
    ['packages/runtime/src/bootstrap.ts', 'Application cannot listen without an HTTP adapter.'],
  ] as const)('reports source drift in %s', (driftedPath, expectedMarker) => {
    // Given
    const readWithoutSourceContract = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutSourceContract);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(expectedMarker);
  });
});
