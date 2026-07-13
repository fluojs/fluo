import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requirements = [
  ['packages/config/src/load.ts', [
    'mergeConfigEntries(targetValue, sourceValue);',
    'options.safeProcessEnv',
    'return validateConfig(options, buildMergedConfig(options));',
  ]],
  ['packages/config/src/module.ts', ['static forRoot(options?: ConfigModuleOptions)', 'global: loadOptions.global ?? true']],
  ['packages/config/src/service.ts', ["const parts = key.split('.');", 'current = current[part];']],
  ['packages/config/src/types.ts', ['processEnv?: NodeJS.ProcessEnv', 'schema?: ConfigSchema', 'global?: boolean']],
  ['packages/runtime/src/bootstrap.ts', [
    'const hasHttpAdapter = effectiveOptions.adapter !== undefined;',
    'effectiveOptions.adapter ??',
    'Application cannot listen without an HTTP adapter.',
  ]],
  ['docs/getting-started/migrate-from-nestjs.md', [
    '@nestjs/config',
    'ConfigModule.forRoot(...)',
    'const namespacedDefaults = await loadNamespacedConfig();',
    'const validatedConfig = ConfigSchema.parse(loadConfig(configSources));',
    'defaults: validatedConfig',
    "ConfigService.get('http.port')",
    'FluoFactory.createApplicationContext(AppModule)',
    'FluoFactory.create(AppModule, { adapter })',
  ]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', [
    '@nestjs/config',
    'ConfigModule.forRoot(...)',
    'const namespacedDefaults = await loadNamespacedConfig();',
    'const validatedConfig = ConfigSchema.parse(loadConfig(configSources));',
    'defaults: validatedConfig',
    "ConfigService.get('http.port')",
    'FluoFactory.createApplicationContext(AppModule)',
    'FluoFactory.create(AppModule, { adapter })',
  ]],
  ['book/beginner/ch11-config.md', [
    'loadConfig(configSources)',
    'defaults: validatedConfig',
    'schema: ConfigSchema',
    'FluoFactory.createApplicationContext(AppModule)',
    'adapter: createFastifyAdapter({ port: validatedConfig.PORT })',
    'await app.listen();',
  ]],
  ['book/beginner/ch11-config.ko.md', [
    'loadConfig(configSources)',
    'defaults: validatedConfig',
    'schema: ConfigSchema',
    'FluoFactory.createApplicationContext(AppModule)',
    'adapter: createFastifyAdapter({ port: validatedConfig.PORT })',
    'await app.listen();',
  ]],
  ['docs/CONTEXT.md', [
    '@nestjs/config',
    'book/beginner/ch11-config.md',
    'plain-object deep merge',
    'FluoFactory.createApplicationContext(AppModule)',
    'only `listen()` requires',
  ]],
  ['docs/CONTEXT.ko.md', [
    '@nestjs/config',
    'book/beginner/ch11-config.ko.md',
    'plain-object deep merge',
    'FluoFactory.createApplicationContext(AppModule)',
    '`listen()`에만 적용',
  ]],
];

export function enforceConfigNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the @nestjs/config migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
