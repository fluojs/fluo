import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const chapterPaths = ['book/beginner/ch14-jwt.md', 'book/beginner/ch14-jwt.ko.md'];
const learningFilePaths = [
  'src/auth/auth.persistence.ts',
  'src/auth/auth.service.ts',
  'src/auth/auth.controller.ts',
  'src/auth/auth.module.ts',
];
const learningFileHeader = /^\/\/ (src\/auth\/auth\.(?:persistence|service|controller|module)\.ts)\n/u;
const virtualRoot = join(repoRoot, '.virtual-jwt-learning-path');
const workspacePublicSources = join(repoRoot, 'packages', '*', 'src', 'index.ts');

function fail(relativePath, message) {
  throw new Error(
    `JWT learning-path module wiring check failed: ${relativePath} ${message}.`,
  );
}

function extractLearningFiles(relativePath, markdown) {
  const files = new Map();

  for (const match of markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/gu)) {
    const source = match[1] ?? '';
    const header = learningFileHeader.exec(source);

    if (header?.[1] !== undefined) {
      files.set(header[1], source.slice(header[0].length));
    }
  }

  for (const learningFilePath of learningFilePaths) {
    if (!files.has(learningFilePath)) {
      fail(relativePath, `must include a \`// ${learningFilePath}\` TypeScript code block`);
    }
  }

  return files;
}

function normalizeSource(sourceText) {
  return sourceText.replace(/\s+/gu, ' ').trim();
}

function enforceExplicitModuleWiring(relativePath, files) {
  const persistenceSource = files.get('src/auth/auth.persistence.ts');
  const serviceSource = files.get('src/auth/auth.service.ts');
  const moduleSource = files.get('src/auth/auth.module.ts');

  if (
    persistenceSource === undefined
    || serviceSource === undefined
    || moduleSource === undefined
  ) {
    fail(relativePath, 'must include every JWT learning-path source block before checking DI wiring');
  }

  const injectionMetadata = [
    [persistenceSource, '@Inject(REFRESH_TOKEN_REPOSITORY)', 'DatabaseRefreshTokenStore'],
    [persistenceSource, '@Inject(CREDENTIALS_REPOSITORY)', 'DatabaseCredentialsVerifier'],
    [serviceSource, '@Inject(CREDENTIALS_VERIFIER, JwtService, RefreshTokenService)', 'AuthService'],
  ];

  for (const [sourceText, metadata, className] of injectionMetadata) {
    if (!sourceText.includes(metadata)) {
      fail(relativePath, `${className} must declare explicit ${metadata} constructor metadata`);
    }
  }

  if (/\bproviders:\s*\[\s*(?:DatabaseRefreshTokenStore|DatabaseCredentialsVerifier)\s*,/u.test(moduleSource)) {
    fail(relativePath, 'must not register a persistence adapter as a bare class provider');
  }

  const normalizedModuleSource = normalizeSource(moduleSource);
  const explicitProviders = [
    '{ provide: REFRESH_TOKEN_STORE, useClass: DatabaseRefreshTokenStore, inject: [REFRESH_TOKEN_REPOSITORY], }',
    '{ provide: CREDENTIALS_VERIFIER, useClass: DatabaseCredentialsVerifier, inject: [CREDENTIALS_REPOSITORY], }',
  ];

  for (const provider of explicitProviders) {
    if (!normalizedModuleSource.includes(provider)) {
      fail(relativePath, `must bind persistence adapters through explicit provider metadata: ${provider}`);
    }
  }
}

function probeRuntimeModuleGraph(relativePath, files) {
  const injectionTokens = new Map();
  const moduleMetadata = new Map();
  const jwtRuntime = { asyncOptions: undefined };
  const core = {
    Inject: (...tokens) => (value) => {
      injectionTokens.set(value, tokens);
    },
    Module: (metadata) => (value) => {
      moduleMetadata.set(value, metadata);
    },
  };
  class ConfigService {
    snapshot() {
      return {
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_SECRET: 'access-secret',
      };
    }
  }
  class JwtService {}
  class RefreshTokenService {}
  const externalModules = {
    '@fluojs/config': {
      ConfigModule: {
        forRoot: () => class ConfigRuntimeModule {},
      },
      ConfigService,
    },
    '@fluojs/core': core,
    '@fluojs/http': {
      Controller: () => () => undefined,
      Post: () => () => undefined,
      RequestDto: () => () => undefined,
    },
    '@fluojs/jwt': {
      JwtModule: {
        forRootAsync: (options) => {
          jwtRuntime.asyncOptions = options;
          return class JwtRuntimeModule {};
        },
      },
      JwtService,
      RefreshTokenService,
    },
  };
  const loadedModules = new Map();

  const loadModule = (filePath) => {
    const existing = loadedModules.get(filePath);

    if (existing !== undefined) {
      return existing;
    }

    const sourceText = files.get(filePath);

    if (sourceText === undefined) {
      fail(relativePath, `runtime probe could not load ${filePath}`);
    }

    const transpiled = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filePath,
      reportDiagnostics: true,
    });
    const diagnostics = (transpiled.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

    if (diagnostics.length > 0) {
      fail(relativePath, `runtime probe could not transpile ${filePath}:\n${diagnostics.join('\n')}`);
    }

    const module = { exports: {} };
    loadedModules.set(filePath, module.exports);
    const require = (specifier) => {
      const externalModule = externalModules[specifier];

      if (externalModule !== undefined) {
        return externalModule;
      }

      if (!specifier.startsWith('./')) {
        fail(relativePath, `runtime probe cannot resolve ${specifier} from ${filePath}`);
      }

      const importedPath = resolve(dirname(join(virtualRoot, filePath)), specifier)
        .replace(/\.js$/u, '.ts')
        .replace(`${virtualRoot}/`, '');

      return loadModule(importedPath);
    };
    const execute = new Function('exports', 'module', 'require', transpiled.outputText);
    execute(module.exports, module, require);
    loadedModules.set(filePath, module.exports);

    return module.exports;
  };

  const persistence = loadModule('src/auth/auth.persistence.ts');
  const service = loadModule('src/auth/auth.service.ts');
  const controller = loadModule('src/auth/auth.controller.ts');
  const authModule = loadModule('src/auth/auth.module.ts');
  const persistenceProviders = moduleMetadata.get(authModule.AuthPersistenceModule)?.providers;

  if (!Array.isArray(persistenceProviders) || jwtRuntime.asyncOptions === undefined) {
    fail(relativePath, 'runtime probe could not register the persistence and JWT module graph');
  }

  const providersByToken = new Map(
    persistenceProviders.map((provider) => [provider.provide, provider]),
  );
  const refreshProvider = providersByToken.get(persistence.REFRESH_TOKEN_STORE);
  const credentialsProvider = providersByToken.get(persistence.CREDENTIALS_VERIFIER);
  const refreshRepository = {
    find: () => undefined,
    revoke: () => undefined,
    revokeByFamily: () => undefined,
    revokeBySubject: () => undefined,
    rotate: () => undefined,
    save: () => undefined,
  };
  const credentialsRepository = {
    verify: () => ({ id: 'user-1', roles: [] }),
  };

  const instantiate = (provider, dependencies) => {
    if (
      provider === undefined
      || provider.useClass === undefined
      || !Array.isArray(provider.inject)
    ) {
      fail(relativePath, 'runtime probe requires explicit class-provider injection metadata');
    }

    return new provider.useClass(...provider.inject.map((token) => dependencies.get(token)));
  };
  const refreshStore = instantiate(refreshProvider, new Map([
    [persistence.REFRESH_TOKEN_REPOSITORY, refreshRepository],
  ]));
  const credentialsVerifier = instantiate(credentialsProvider, new Map([
    [persistence.CREDENTIALS_REPOSITORY, credentialsRepository],
  ]));
  const createInjectedInstance = (type, dependencies) => {
    const tokens = injectionTokens.get(type);

    if (tokens === undefined) {
      fail(relativePath, `runtime probe requires explicit @Inject metadata for ${type.name}`);
    }

    return new type(...tokens.map((token) => dependencies.get(token)));
  };
  const authService = createInjectedInstance(service.AuthService, new Map([
    [persistence.CREDENTIALS_VERIFIER, credentialsVerifier],
    [JwtService, new JwtService()],
    [RefreshTokenService, new RefreshTokenService()],
  ]));
  const authController = createInjectedInstance(controller.AuthController, new Map([
    [service.AuthService, authService],
  ]));

  if (refreshStore.repository !== refreshRepository || credentialsVerifier.repository !== credentialsRepository || authController.authService !== authService) {
    fail(relativePath, 'runtime probe could not instantiate the documented dependency graph');
  }
}

function collectDiagnostics(files) {
  const compilerOptions = {
    baseUrl: repoRoot,
    exactOptionalPropertyTypes: true,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@fluojs/*': [workspacePublicSources],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ['node'],
  };
  const virtualFiles = new Map(
    [...files].map(([filePath, sourceText]) => [join(virtualRoot, filePath), sourceText]),
  );
  const virtualDirectories = new Set(
    [...virtualFiles.keys()].flatMap((fileName) => [
      dirname(fileName),
      dirname(dirname(fileName)),
      dirname(dirname(dirname(fileName))),
    ]),
  );
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultDirectoryExists = host.directoryExists.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const isVirtualFile = (fileName) => virtualFiles.has(resolve(fileName));

  host.directoryExists = (directoryName) =>
    virtualDirectories.has(resolve(directoryName)) || defaultDirectoryExists(directoryName);
  host.fileExists = (fileName) => isVirtualFile(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(resolve(fileName)) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceText = virtualFiles.get(resolve(fileName));

    return sourceText === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
  };

  const program = ts.createProgram([...virtualFiles.keys()], compilerOptions, host);

  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .filter((diagnostic) => diagnostic.file === undefined || isVirtualFile(diagnostic.file.fileName))
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return message;
      }

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName.replace(`${virtualRoot}/`, '')}:${position.line + 1}:${position.character + 1} ${message}`;
    });
}

/**
 * Typechecks the complete Chapter 14 JWT learning path as virtual source files
 * against the workspace's public package declarations.
 */
export function enforceJwtLearningPathModuleWiring(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of chapterPaths) {
    const files = extractLearningFiles(relativePath, readText(relativePath));
    enforceExplicitModuleWiring(relativePath, files);
    const diagnostics = collectDiagnostics(files);

    if (diagnostics.length > 0) {
      fail(
        relativePath,
        `must typecheck as the complete virtual JWT learning path:\n${diagnostics.join('\n')}`,
      );
    }

    probeRuntimeModuleGraph(relativePath, files);
  }
}
