import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it } from 'vitest';

import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const servicePath = 'packages/config/src/service.ts';

type SingleKeyMethod = 'get' | 'getOrThrow';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/**
 * Rewrites the single-key implementation line of `ConfigService.<methodName>` so a fixture can
 * model a widened call shape. Both the anchor match and the resulting edit are asserted so a
 * reformatted service source fails loudly instead of silently producing a vacuous fixture.
 */
function mutateServiceSource(
  methodName: SingleKeyMethod,
  buildReplacement: (implementationLine: string, indent: string) => string,
): string {
  const source = read(servicePath);
  const match = source.match(new RegExp(`^([ \\t]*)${methodName}<.*\\{$`, 'mu'));

  expect(match, `expected a single-key ${methodName} implementation line in ${servicePath}`).not.toBeNull();

  const [implementationLine, indent] = match as RegExpMatchArray;
  const mutated = source.replace(implementationLine, buildReplacement(implementationLine, indent));

  expect(mutated, `expected the ${methodName} fixture to change ${servicePath}`).not.toBe(source);

  return mutated;
}

function readWithMutatedService(mutated: string): (relativePath: string) => string {
  return (relativePath: string): string => (relativePath === servicePath ? mutated : read(relativePath));
}

/**
 * Rewrites the declared return type of `ConfigService.<methodName>` while leaving its single-key
 * parameter list untouched, so return-shape classification can be exercised on its own.
 */
function mutateServiceReturnType(methodName: SingleKeyMethod, returnType: string): string {
  return mutateServiceSource(methodName, (implementationLine) => {
    const rewritten = implementationLine.replace(/\):\s.*\{$/u, `): ${returnType} {`);

    expect(rewritten, `expected to rewrite the ${methodName} return type`).not.toBe(implementationLine);

    return rewritten;
  });
}

/**
 * Appends a declaration-merged `interface ConfigService` that widens `methodName` with a second
 * parameter. The class body is left untouched, so only an effective-signature check can see it.
 */
function appendMergedInterfaceOverload(methodName: SingleKeyMethod): string {
  const source = read(servicePath);
  const mergedInterface = [
    '',
    'export interface ConfigService<T extends Record<string, unknown> = ConfigDictionary> {',
    `  ${methodName}<K extends DotPaths<T>, D>(key: K, defaultValue: D): DotValue<T, K & string> | D;`,
    '}',
    '',
  ].join('\n');

  expect(source, `expected ${servicePath} to declare the ConfigService class`).toContain('class ConfigService');

  return `${source}${mergedInterface}`;
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
    expect(typesSource).toContain('export type ConfigProcessEnv = Record<string, string | undefined>');
    expect(typesSource).toContain('processEnv?: ConfigProcessEnv');
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

  it.each(['get', 'getOrThrow'] as const)(
    'rejects an added %s overload that leaves the single-key implementation intact',
    (methodName) => {
      // Given
      const mutated = mutateServiceSource(
        methodName,
        (implementationLine, indent) =>
          `${indent}${methodName}<K extends DotPaths<T>, D>(key: K, defaultValue?: D): DotValue<T, K & string> | D;\n${implementationLine}`,
      );

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

  it.each([
    ['get', 'defaultValue: DotValue<T, K & string>'],
    ['get', 'options: { infer: true }'],
    ['getOrThrow', 'defaultValue: DotValue<T, K & string>'],
    ['getOrThrow', 'options: { infer: true }'],
  ] as const)('rejects a second %s parameter declared as %s', (methodName, secondParameter) => {
    // Given
    const mutated = mutateServiceSource(methodName, (implementationLine) =>
      implementationLine.replace('(key: K)', `(key: K, ${secondParameter})`),
    );

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
    expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
  });

  it.each(['get', 'getOrThrow'] as const)(
    'rejects a declaration-merged interface overload that widens %s',
    (methodName) => {
      // Given
      const mutated = appendMergedInterfaceOverload(methodName);

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

  it('rejects an undefined-like void result for getOrThrow', () => {
    // Given
    const mutated = mutateServiceReturnType('getOrThrow', 'void');

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
    expect(runGovernanceGuard).toThrow('ConfigService.getOrThrow');
  });

  it.each([
    ['a parenthesized union', '(DotValue<T, K & string> | undefined)'],
    ['a union ordered undefined first', 'undefined | DotValue<T, K & string>'],
  ] as const)('accepts %s as the optional get result', (_shape, returnType) => {
    // Given
    const mutated = mutateServiceReturnType('get', returnType);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('accepts an alias that resolves to an optional get result', () => {
    // Given
    const aliased = `type MaybeValue<V> = V | undefined;\n${mutateServiceReturnType(
      'get',
      'MaybeValue<DotValue<T, K & string>>',
    )}`;

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(aliased));

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects a get result whose type cannot be resolved', () => {
    // Given
    const unresolvable = read(servicePath).replace(
      "import type { ConfigDictionary, DotPaths, DotValue } from './types.js';",
      '',
    );

    expect(unresolvable, 'expected the type-import fixture to change the service source').not.toBe(
      read(servicePath),
    );

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(unresolvable));

    // Then
    expect(runGovernanceGuard).toThrow(servicePath);
  });

  it.each(['get', 'getOrThrow'] as const)(
    'rejects a reformatted multi-line %s signature that adds a second parameter',
    (methodName) => {
      // Given
      const mutated = mutateServiceSource(methodName, (implementationLine, indent) =>
        implementationLine.replace(
          '(key: K)',
          `(\n${indent}  key: K,\n${indent}  options: { infer: true },\n${indent})`,
        ),
      );

      // When
      const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithMutatedService(mutated));

      // Then
      expect(runGovernanceGuard).toThrow(servicePath);
      expect(runGovernanceGuard).toThrow(`ConfigService.${methodName}`);
    },
  );

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
