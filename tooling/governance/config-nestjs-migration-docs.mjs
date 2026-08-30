import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configServiceSourcePath = 'packages/config/src/service.ts';

// `ConfigService` reads resolve one key at a time. NestJS `get(key, defaultValue)` and
// `get(key, { infer: true })` overloads have no fluo counterpart, so this contract is enforced
// through the TypeScript checker rather than through source text markers or a syntax-only scan.
// String markers pin one formatting of one signature while still admitting an added overload, and
// a first-class-member scan cannot see a declaration-merged `interface ConfigService`. Resolving
// the merged symbol and classifying each effective signature covers both, and keeps return-shape
// classification semantic so `void`, aliases, and parentheses are judged by meaning, not spelling.
const singleKeyCallShapes = [
  { methodName: 'get', resolvesToOptional: true },
  { methodName: 'getOrThrow', resolvesToOptional: false },
];

const configServiceProgramOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  strict: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
  types: [],
  noEmit: true,
};

// Default library files are identical across fixtures, so parsing them once keeps each guarded
// analysis in single-digit milliseconds instead of rebuilding a full program per invocation.
const defaultLibrarySourceCache = new Map();
const requirements = [
  ['packages/config/src/load.ts', [
    'mergeConfigEntries(targetValue, sourceValue);',
    'options.safeProcessEnv',
    'return validateConfig(options, buildMergedConfig(options));',
  ]],
  ['packages/config/src/module.ts', ['static forRoot(options?: ConfigModuleOptions)', 'global: loadOptions.global ?? true']],
  ['packages/config/src/service.ts', ["const parts = key.split('.');", 'current = current[part];']],
  ['packages/config/src/types.ts', ['processEnv?: NodeJS.ProcessEnv', 'schema?: ConfigSchema', 'global?: boolean']],
  ['packages/config/README.md', [
    '### NestJS Registration Migration',
    'ConfigModule.forRootAsync(...)',
    'ConfigReloadModule.forRoot(...)',
    'NestJS `load` factories',
    'explicit `processEnv` snapshot',
    'synchronous Standard Schema',
    '`global`, not NestJS `isGlobal`',
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

function failConfigServiceCallShape(methodName, detail) {
  throw new Error(
    `Platform consistency governance check failed: ${configServiceSourcePath} ConfigService.${methodName} ${detail}.`,
  );
}

/**
 * Structurally proves that `ConfigService.get` and `getOrThrow` each expose exactly one call
 * signature taking exactly one required `key` parameter, independent of generic nesting and
 * formatting. Overloads, options parameters, and default-value parameters are all rejected.
 */
/**
 * Builds a single-file program for the service source. Relative specifiers are mapped directly from
 * their emitted `.js` form to the authored `.ts` file so the sibling config types resolve without a
 * package.json probe; bare specifiers stay unresolved because no guarded signature depends on them.
 */
function createConfigServiceProgram(sourceText) {
  const absoluteServicePath = resolve(repoRoot, configServiceSourcePath);
  const host = ts.createCompilerHost(configServiceProgramOptions, true);
  const readSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (resolve(fileName) === absoluteServicePath) {
      return ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
    }

    if (fileName.endsWith('.d.ts')) {
      const cached = defaultLibrarySourceCache.get(fileName);

      if (cached !== undefined) {
        return cached;
      }

      const parsed = readSourceFile(fileName, languageVersion, onError, shouldCreate);

      if (parsed !== undefined) {
        defaultLibrarySourceCache.set(fileName, parsed);
      }

      return parsed;
    }

    return readSourceFile(fileName, languageVersion, onError, shouldCreate);
  };

  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (!moduleName.startsWith('.')) {
        return undefined;
      }

      return {
        resolvedFileName: join(dirname(containingFile), moduleName.replace(/\.js$/u, '.ts')),
        extension: ts.Extension.Ts,
        isExternalLibraryImport: false,
      };
    });

  const program = ts.createProgram([absoluteServicePath], configServiceProgramOptions, host);

  return { program, sourceFile: program.getSourceFile(absoluteServicePath) };
}

/**
 * Classifies a resolved return type as undefined-like. `void` and `undefined` both describe an
 * absent value, and union constituents are inspected so parentheses, aliases, and ordering cannot
 * change the verdict.
 */
function describeReturnType(checker, signature) {
  const returnType = checker.getReturnTypeOfSignature(signature);
  const constituents = returnType.isUnion() ? returnType.types : [returnType];
  const undefinedLike = ts.TypeFlags.Undefined | ts.TypeFlags.Void;

  return {
    text: checker.typeToString(returnType),
    // An unresolved return type collapses to `any`, which would silently read as "not optional".
    // Treat it as unusable evidence so the guard fails closed instead of passing on a widened API.
    isUnresolved: constituents.some((constituent) => (constituent.flags & ts.TypeFlags.Any) !== 0),
    isUndefinedLike: constituents.some((constituent) => (constituent.flags & undefinedLike) !== 0),
  };
}

function enforceConfigServiceSingleKeyCallShape(sourceText) {
  const { program, sourceFile } = createConfigServiceProgram(sourceText);
  const checker = program.getTypeChecker();
  const classDeclaration = sourceFile?.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'ConfigService',
  );

  if (classDeclaration === undefined) {
    throw new Error(
      `Platform consistency governance check failed: ${configServiceSourcePath} must declare the ConfigService class.`,
    );
  }

  const classSymbol = checker.getSymbolAtLocation(classDeclaration.name);

  if (classSymbol === undefined) {
    throw new Error(
      `Platform consistency governance check failed: ${configServiceSourcePath} must resolve the ConfigService symbol.`,
    );
  }

  // The declared type of the merged symbol carries every effective member, including those added by
  // a declaration-merged `interface ConfigService`, which a class-body scan would never observe.
  const instanceType = checker.getDeclaredTypeOfSymbol(classSymbol);

  for (const { methodName, resolvesToOptional } of singleKeyCallShapes) {
    const property = checker.getPropertyOfType(instanceType, methodName);

    if (property === undefined) {
      failConfigServiceCallShape(methodName, 'must remain a public member of ConfigService');
    }

    const signatures = checker
      .getTypeOfSymbolAtLocation(property, classDeclaration)
      .getCallSignatures();

    if (signatures.length !== 1) {
      failConfigServiceCallShape(
        methodName,
        `must expose exactly one call signature, found ${signatures.length}`,
      );
    }

    const [signature] = signatures;
    const parameters = signature.getParameters();

    if (parameters.length !== 1) {
      failConfigServiceCallShape(
        methodName,
        `must accept exactly one parameter, found ${parameters.length}`,
      );
    }

    const [parameter] = parameters;
    const [parameterDeclaration] = parameter.getDeclarations() ?? [];

    if (
      parameter.getName() !== 'key' ||
      parameterDeclaration === undefined ||
      !ts.isParameter(parameterDeclaration) ||
      parameterDeclaration.questionToken !== undefined ||
      parameterDeclaration.initializer !== undefined ||
      parameterDeclaration.dotDotDotToken !== undefined
    ) {
      failConfigServiceCallShape(methodName, 'must accept exactly one required "key" parameter');
    }

    const returnType = describeReturnType(checker, signature);

    if (returnType.isUnresolved) {
      failConfigServiceCallShape(
        methodName,
        `must declare a resolvable return type, found "${returnType.text}"`,
      );
    }

    if (returnType.isUndefinedLike !== resolvesToOptional) {
      failConfigServiceCallShape(
        methodName,
        `must ${resolvesToOptional ? 'include' : 'exclude'} an undefined-like return type, found "${returnType.text}"`,
      );
    }
  }
}

export function enforceConfigNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceConfigServiceSingleKeyCallShape(readText(configServiceSourcePath));

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
