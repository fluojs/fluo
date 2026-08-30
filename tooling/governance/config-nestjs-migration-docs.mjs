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
  ['packages/config/src/service.ts', [
    "const parts = key.split('.');",
    'current = current[part];',
    'get<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {',
    'getOrThrow<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {',
  ]],
  ['packages/config/src/types.ts', ['processEnv?: NodeJS.ProcessEnv', 'schema?: ConfigSchema', 'global?: boolean']],
  ['packages/config/README.md', [
    '### NestJS Registration Migration',
    'ConfigModule.forRootAsync(...)',
    'ConfigReloadModule.forRoot(...)',
    'NestJS `load` factories',
    'explicit `processEnv` snapshot',
    'synchronous Standard Schema',
    '`global`, not NestJS `isGlobal`',
    '`ConfigService.get(key)` and `getOrThrow(key)` take one key and expose no NestJS default-value or options overload',
    '../../docs/getting-started/migrate-from-nestjs.md',
  ]],
  ['packages/config/README.ko.md', [
    '### NestJS 등록 마이그레이션',
    'ConfigModule.forRootAsync(...)',
    'ConfigReloadModule.forRoot(...)',
    'NestJS `load` factory',
    '명시적 `processEnv` snapshot',
    '동기 Standard Schema',
    'NestJS `isGlobal`이 아니라 `global`',
    '`ConfigService.get(key)`와 `getOrThrow(key)`는 key 하나만 받으며 NestJS default-value 또는 options overload를 노출하지 않습니다',
    '../../docs/getting-started/migrate-from-nestjs.ko.md',
  ]],
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
    'get(key, defaultValue)',
    'get(key, { infer: true })',
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
    'get(key, defaultValue)',
    'get(key, { infer: true })',
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

const semanticRequirements = [
  {
    relativePath: 'packages/config/README.md',
    required: [
      {
        pattern: /`ConfigModule` exposes only synchronous `forRoot\(\.\.\.\)` registration and has no `ConfigModule\.forRootAsync\(\.\.\.\)` counterpart/iu,
        message: 'must state that ConfigModule exposes synchronous forRoot without forRootAsync',
      },
      {
        pattern: /(?:resolve|await)[^.\n]*(?:asynchronous sources|remote secrets)[^.\n]*application-owned bootstrap boundary/iu,
        message: 'must require asynchronous sources at the application-owned bootstrap boundary',
      },
    ],
    forbidden: [
      {
        pattern: /only module registration API in `@fluojs\/config`/iu,
        message: 'must scope the synchronous-only registration claim to ConfigModule',
      },
      {
        pattern: /\b(?:provides?|supports?|offers?)\s+`ConfigModule\.forRootAsync\(\.\.\.\)`/iu,
        message: 'must not claim that ConfigModule provides forRootAsync',
      },
      {
        pattern: /\b(?:use|accepts?|allows?|supports?)\b[^.\n]*(?:asynchronous|async)\s+Standard Schema\b/iu,
        message: 'must not allow asynchronous Standard Schema validation',
      },
    ],
  },
  {
    relativePath: 'book/beginner/ch11-config.md',
    required: [
      {
        pattern: /`ConfigModule` never fetches from an external Provider itself/u,
        message: 'must state that ConfigModule does not read from external secret Providers',
      },
    ],
    forbidden: [
      {
        pattern: /update the `ConfigModule` logic so it reads values from those external Providers/u,
        message: 'must not tell readers to make ConfigModule read from external Providers',
      },
    ],
  },
  {
    relativePath: 'book/beginner/ch11-config.ko.md',
    required: [
      {
        pattern: /`ConfigModule` 자체가 외부 프로바이더에서 값을 가져오지는 않습니다/u,
        message: 'must state that ConfigModule does not read from external secret Providers',
      },
    ],
    forbidden: [
      {
        pattern: /외부 프로바이더로부터 값을 가져오도록 `ConfigModule` 로직만 업데이트/u,
        message: 'must not tell readers to make ConfigModule read from external Providers',
      },
    ],
  },
  {
    relativePath: 'packages/config/README.ko.md',
    required: [
      {
        pattern: /`ConfigModule`은 동기 `forRoot\(\.\.\.\)` registration만 노출하며 `ConfigModule\.forRootAsync\(\.\.\.\)`에 대응하는 API는 없습니다/u,
        message: 'must state that ConfigModule exposes synchronous forRoot without forRootAsync',
      },
      {
        pattern: /(?:remote secrets?|비동기 sources?)[^.\n]*application-owned bootstrap boundary[^.\n]*(?:resolve|await)/iu,
        message: 'must require asynchronous sources at the application-owned bootstrap boundary',
      },
    ],
    forbidden: [
      {
        pattern: /`@fluojs\/config`의 유일한 module registration API/u,
        message: 'must scope the synchronous-only registration claim to ConfigModule',
      },
      {
        pattern: /`ConfigModule\.forRootAsync\(\.\.\.\)`[^.\n]*(?:제공합니다|지원합니다|사용할 수 있습니다)/u,
        message: 'must not claim that ConfigModule provides forRootAsync',
      },
      {
        pattern: /설정\s*검증(?:에는|에)[^.\n]*비동기\s+Standard Schema[^.\n]*(?:사용합니다|사용하세요|허용합니다|지원합니다)/u,
        message: 'must not allow asynchronous Standard Schema validation',
      },
    ],
  },
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

  for (const { relativePath, required, forbidden } of semanticRequirements) {
    const content = readText(relativePath);

    for (const { pattern, message } of required) {
      if (!pattern.test(content)) {
        throw new Error(`Platform consistency governance check failed: ${relativePath} ${message}.`);
      }
    }

    for (const { pattern, message } of forbidden) {
      if (pattern.test(content)) {
        throw new Error(`Platform consistency governance check failed: ${relativePath} ${message}.`);
      }
    }
  }
}
