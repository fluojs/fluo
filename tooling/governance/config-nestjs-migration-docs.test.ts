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
    const englishReadme = read('packages/config/README.md');
    const koreanReadme = read('packages/config/README.ko.md');
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
    expect(englishReadme).toContain('### NestJS Registration Migration');
    expect(englishReadme).toContain('ConfigModule.forRootAsync(...)');
    expect(englishReadme).toContain('NestJS `load` factories');
    expect(englishReadme).toContain('explicit `processEnv` snapshot');
    expect(englishReadme).toContain('synchronous Standard Schema');
    expect(englishReadme).toContain('`global`, not NestJS `isGlobal`');
    expect(englishReadme).toContain('../../docs/getting-started/migrate-from-nestjs.md');
    expect(koreanReadme).toContain('### NestJS 등록 마이그레이션');
    expect(koreanReadme).toContain('ConfigModule.forRootAsync(...)');
    expect(koreanReadme).toContain('NestJS `load` factory');
    expect(koreanReadme).toContain('명시적 `processEnv` snapshot');
    expect(koreanReadme).toContain('동기 Standard Schema');
    expect(koreanReadme).toContain('NestJS `isGlobal`이 아니라 `global`');
    expect(koreanReadme).toContain('../../docs/getting-started/migrate-from-nestjs.ko.md');
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

  it('documents the single-key ConfigService call shape backed by the service signatures', () => {
    // Given
    const serviceSource = read('packages/config/src/service.ts');
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');
    const englishReadme = read('packages/config/README.md');
    const koreanReadme = read('packages/config/README.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    expect(serviceSource).toContain('get<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {');
    expect(serviceSource).toContain('getOrThrow<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {');
    expect(serviceSource).not.toMatch(/\bget<[^>]*>\(key: K, /u);
    expect(serviceSource).not.toMatch(/\bgetOrThrow<[^>]*>\(key: K, /u);

    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain('get(key, defaultValue)');
      expect(migrationDoc).toContain('get(key, { infer: true })');
    }

    expect(englishReadme).toContain(
      '`ConfigService.get(key)` and `getOrThrow(key)` take one key and expose no NestJS default-value or options overload',
    );
    expect(koreanReadme).toContain(
      '`ConfigService.get(key)`\uc640 `getOrThrow(key)`\ub294 key \ud558\ub098\ub9cc \ubc1b\uc73c\uba70 NestJS default-value \ub610\ub294 options overload\ub97c \ub178\ucd9c\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4',
    );
  });

  it('keeps external secret resolution at the application entrypoint in the bilingual config chapter', () => {
    // Given
    const englishChapter = read('book/beginner/ch11-config.md');
    const koreanChapter = read('book/beginner/ch11-config.ko.md');

    // Then
    expect(englishChapter).toContain('`ConfigModule` never fetches from an external Provider itself');
    expect(englishChapter).not.toContain(
      'update the `ConfigModule` logic so it reads values from those external Providers',
    );
    expect(koreanChapter).toContain('`ConfigModule` \uc790\uccb4\uac00 \uc678\ubd80 \ud504\ub85c\ubc14\uc774\ub354\uc5d0\uc11c \uac12\uc744 \uac00\uc838\uc624\uc9c0\ub294 \uc54a\uc2b5\ub2c8\ub2e4');
    expect(koreanChapter).not.toContain(
      '\uc678\ubd80 \ud504\ub85c\ubc14\uc774\ub354\ub85c\ubd80\ud130 \uac12\uc744 \uac00\uc838\uc624\ub3c4\ub85d `ConfigModule` \ub85c\uc9c1\ub9cc \uc5c5\ub370\uc774\ud2b8',
    );
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
