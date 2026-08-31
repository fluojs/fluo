import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

const virtualRoot = '/virtual-jwt-learning-path';

function fail(relativePath, message) {
  throw new Error(`JWT learning-path module wiring check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function sameSequence(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function loadLearningModules(relativePath, files) {
  const injectionTokens = new Map();
  const moduleMetadata = new Map();
  const configRuntime = { module: undefined };
  const jwtRuntime = { asyncOptions: undefined, module: undefined };
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
  class JwtService {
    async sign(claims, options) {
      return `access:${claims.roles.join(',')}:${options.subject}`;
    }
  }
  class RefreshTokenService {
    constructor(store) {
      this.store = store;
      this.nextId = 0;
    }

    async issueRefreshToken(subject) {
      this.nextId += 1;
      const id = `refresh-${this.nextId}`;
      await this.store.save({ family: 'family-1', id, subject, used: false });
      return id;
    }

    async rotateRefreshToken(tokenId) {
      const current = await this.store.find(tokenId);

      if (!current) {
        throw new Error('Refresh token record was not found.');
      }

      this.nextId += 1;
      const replacement = { family: current.family, id: `refresh-${this.nextId}`, subject: current.subject, used: false };
      const result = await this.store.rotate({ replacement, tokenId });

      if (result !== 'consumed') {
        throw new Error(`Refresh token rotation failed: ${result}.`);
      }

      return { accessToken: `rotated:${current.subject}`, refreshToken: replacement.id };
    }
  }
  const externalModules = {
    '@fluojs/config': {
      ConfigModule: {
        forRoot: () => {
          class ConfigRuntimeModule {}
          configRuntime.module = ConfigRuntimeModule;
          return ConfigRuntimeModule;
        },
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
          class JwtRuntimeModule {}
          jwtRuntime.asyncOptions = options;
          jwtRuntime.module = JwtRuntimeModule;
          return JwtRuntimeModule;
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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
    new Function('exports', 'module', 'require', transpiled.outputText)(module.exports, module, require);
    loadedModules.set(filePath, module.exports);
    return module.exports;
  };

  return {
    authModule: loadModule('src/auth/auth.module.ts'),
    configRuntime,
    controller: loadModule('src/auth/auth.controller.ts'),
    core,
    injectionTokens,
    jwtRuntime,
    moduleMetadata,
    persistence: loadModule('src/auth/auth.persistence.ts'),
    service: loadModule('src/auth/auth.service.ts'),
    types: { ConfigService, JwtService, RefreshTokenService },
  };
}

function providerFor(providers, token) {
  return providers.find((provider) => provider?.provide === token);
}

function instantiate(provider, dependencies, relativePath) {
  assert(
    provider?.useClass !== undefined && Array.isArray(provider.inject),
    relativePath,
    'runtime probe requires explicit class-provider injection metadata',
  );
  return new provider.useClass(...provider.inject.map((token) => dependencies.get(token)));
}

function createRepositoryFakes() {
  const records = new Map();
  const refreshRepository = {
    async find(id) {
      return records.get(id);
    },
    async revoke(id) {
      const record = records.get(id);
      if (record) records.set(id, { ...record, used: true });
    },
    async revokeByFamily(family) {
      for (const [id, record] of records) {
        if (record.family === family) records.set(id, { ...record, used: true });
      }
    },
    async revokeBySubject(subject) {
      for (const [id, record] of records) {
        if (record.subject === subject) records.set(id, { ...record, used: true });
      }
    },
    async rotate({ replacement, tokenId }) {
      const current = records.get(tokenId);
      if (!current) return 'not_found';
      if (current.used) return 'already_used';
      records.set(tokenId, { ...current, used: true });
      records.set(replacement.id, replacement);
      return 'consumed';
    },
    async save(record) {
      records.set(record.id, record);
    },
  };
  const credentialsRepository = {
    async verify(email, password) {
      if (email !== 'user@example.com' || password !== 'correct-password') {
        throw new Error('Invalid credentials.');
      }
      return { id: 'user-1', roles: ['reader'] };
    },
  };

  return { credentialsRepository, records, refreshRepository };
}

/**
 * Executes the extracted learning-path classes through an equivalent Fluo
 * module graph and repository contracts.
 */
export async function probeJwtLearningPathRuntimeGraph(relativePath, files) {
  const loaded = loadLearningModules(relativePath, files);
  const { authModule, controller, injectionTokens, jwtRuntime, moduleMetadata, persistence, service, types } = loaded;
  const persistenceDefinition = moduleMetadata.get(authModule.AuthPersistenceModule);
  const authDefinition = moduleMetadata.get(authModule.AuthModule);

  assert(persistenceDefinition?.global === true, relativePath, 'AuthPersistenceModule must set global: true');
  assert(
    sameSequence(persistenceDefinition?.exports, [
      persistence.REFRESH_TOKEN_STORE,
      persistence.CREDENTIALS_VERIFIER,
    ]),
    relativePath,
    'AuthPersistenceModule must export exactly REFRESH_TOKEN_STORE and CREDENTIALS_VERIFIER',
  );
  assert(
    Array.isArray(authDefinition?.imports)
      && authDefinition.imports.length === 3
      && authDefinition.imports[0] === loaded.configRuntime.module
      && authDefinition.imports[1] === authModule.AuthPersistenceModule
      && authDefinition.imports[2] === jwtRuntime.module,
    relativePath,
    'AuthModule imports must include ConfigModule.forRoot(), AuthPersistenceModule, and JwtModule.forRootAsync(...)',
  );
  assert(
    sameSequence(authDefinition?.providers, [service.AuthService])
      && sameSequence(authDefinition?.controllers, [controller.AuthController]),
    relativePath,
    'AuthModule must register AuthService and AuthController',
  );
  assert(
    sameSequence(injectionTokens.get(service.AuthService), [
      persistence.CREDENTIALS_VERIFIER,
      types.JwtService,
      types.RefreshTokenService,
    ]),
    relativePath,
    'AuthService must inject CREDENTIALS_VERIFIER, JwtService, then RefreshTokenService',
  );
  assert(
    sameSequence(jwtRuntime.asyncOptions?.inject, [types.ConfigService, persistence.REFRESH_TOKEN_STORE]),
    relativePath,
    'JwtModule factory must inject ConfigService then REFRESH_TOKEN_STORE',
  );

  const providers = persistenceDefinition.providers;
  const refreshProvider = providerFor(providers, persistence.REFRESH_TOKEN_STORE);
  const credentialsProvider = providerFor(providers, persistence.CREDENTIALS_VERIFIER);
  const { credentialsRepository, records, refreshRepository } = createRepositoryFakes();
  const refreshStore = instantiate(refreshProvider, new Map([[persistence.REFRESH_TOKEN_REPOSITORY, refreshRepository]]), relativePath);
  const credentialsVerifier = instantiate(credentialsProvider, new Map([[persistence.CREDENTIALS_REPOSITORY, credentialsRepository]]), relativePath);
  const options = await jwtRuntime.asyncOptions.useFactory(new types.ConfigService(), refreshStore);

  assert(options.refreshToken?.store === refreshStore, relativePath, 'JwtModule factory must return the injected durable refresh store');

  const jwtService = new types.JwtService();
  const refreshTokens = new types.RefreshTokenService(refreshStore);
  const authService = new service.AuthService(credentialsVerifier, jwtService, refreshTokens);
  const authController = new controller.AuthController(authService);
  const signedIn = await authController.login({ email: 'user@example.com', password: 'correct-password' });
  const issued = await refreshStore.find(signedIn.refreshToken);
  const rotated = await authController.refresh({ refreshToken: signedIn.refreshToken });

  assert(
    signedIn.accessToken === 'access:reader:user-1'
      && issued?.subject === 'user-1'
      && records.get(signedIn.refreshToken)?.used === true
      && records.get(rotated.refreshToken)?.used === false,
    relativePath,
    'runtime probe must verify credentials and exercise refresh save, find, and rotation',
  );
}
