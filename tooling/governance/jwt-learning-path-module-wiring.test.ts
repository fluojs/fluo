import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigModule, ConfigService } from '../../packages/config/src/index.js';
import { Inject, Module } from '../../packages/core/src/index.js';
import { JwtModule, JwtService, RefreshTokenService } from '../../packages/jwt/src/index.js';
import { compileModuleGraph } from '../../packages/runtime/src/module-graph.js';
import { describe, expect, it } from 'vitest';

import { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function defineExactAuthModuleGraph() {
  const refreshTokenStore = Symbol('REFRESH_TOKEN_STORE');
  const credentialsVerifier = Symbol('CREDENTIALS_VERIFIER');
  const refreshTokenRepository = Symbol('REFRESH_TOKEN_REPOSITORY');
  const credentialsRepository = Symbol('CREDENTIALS_REPOSITORY');

  @Inject(refreshTokenRepository)
  class DatabaseRefreshTokenStore {
    constructor(_repository: object) {}
  }

  @Inject(credentialsRepository)
  class DatabaseCredentialsVerifier {
    constructor(_repository: object) {}
  }

  @Inject(credentialsVerifier, JwtService, RefreshTokenService)
  class AuthService {
    constructor(
      _credentials: DatabaseCredentialsVerifier,
      _jwtService: JwtService,
      _refreshTokens: RefreshTokenService,
    ) {}
  }

  @Inject(AuthService)
  class AuthController {
    constructor(_authService: AuthService) {}
  }

  @Module({
    exports: [refreshTokenStore, credentialsVerifier],
    global: true,
    providers: [
      {
        inject: [refreshTokenRepository],
        provide: refreshTokenStore,
        useClass: DatabaseRefreshTokenStore,
      },
      {
        inject: [credentialsRepository],
        provide: credentialsVerifier,
        useClass: DatabaseCredentialsVerifier,
      },
    ],
  })
  class AuthPersistenceModule {}

  @Module({
    controllers: [AuthController],
    imports: [
      ConfigModule.forRoot(),
      AuthPersistenceModule,
      JwtModule.forRootAsync({
        inject: [ConfigService, refreshTokenStore],
        useFactory: () => ({
          algorithms: ['HS256'],
          refreshToken: {
            expiresInSeconds: 3600,
            rotation: true,
            secret: 'refresh-secret',
            store: {
              find: async () => undefined,
              revoke: async () => undefined,
              revokeBySubject: async () => undefined,
              rotate: async () => 'not_found' as const,
              save: async () => undefined,
            },
          },
          secret: 'access-secret',
        }),
      }),
    ],
    providers: [AuthService],
  })
  class AuthModule {}

  return {
    credentialsRepository,
    refreshTokenRepository,
    rootModule: AuthModule,
  };
}

describe('JWT Chapter 14 executable module wiring', () => {
  it('compiles the exact-shaped AuthModule graph with explicit runtime repository providers', () => {
    // Given
    const graph = defineExactAuthModuleGraph();

    // When
    const compiledModules = compileModuleGraph(graph.rootModule, {
      providers: [
        { provide: graph.refreshTokenRepository, useValue: {} },
        { provide: graph.credentialsRepository, useValue: {} },
      ],
    });

    // Then
    expect(compiledModules.some((compiledModule) => compiledModule.type === graph.rootModule)).toBe(true);
  });

  it.each([
    'book/beginner/ch14-jwt.md',
    'book/beginner/ch14-jwt.ko.md',
  ])('%s resolves its complete learning path through tracked public source and the runtime module graph', (relativePath) => {
    // Given
    const readOnlyPath = (candidatePath: string): string => read(candidatePath);

    // When
    const typecheckLearningPath = () => enforceJwtLearningPathModuleWiring(readOnlyPath);

    // Then
    expect(typecheckLearningPath).not.toThrow();
  });

  it('rejects a chapter whose persistence module no longer exports its refresh-token token', () => {
    // Given
    const readWithoutRefreshTokenExport = (relativePath: string): string => {
      const content = read(relativePath);

      return relativePath === 'book/beginner/ch14-jwt.md'
        ? content.replace('export const REFRESH_TOKEN_STORE = Symbol(\'REFRESH_TOKEN_STORE\');', '')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceJwtLearningPathModuleWiring(readWithoutRefreshTokenExport);

    // Then
    expect(runGovernanceGuard).toThrow(/REFRESH_TOKEN_STORE/);
  });

  it('rejects a chapter whose auth service imports persistence symbols from the wrong module', () => {
    // Given
    const readWithWrongPersistenceImport = (relativePath: string): string => {
      const content = read(relativePath);

      return relativePath === 'book/beginner/ch14-jwt.md'
        ? content.replace('} from \'./auth.persistence.js\';', '} from \'./auth.module.js\';')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceJwtLearningPathModuleWiring(readWithWrongPersistenceImport);

    // Then
    expect(runGovernanceGuard).toThrow(/auth\.module\.js/);
  });

  it.each([
    ['refresh-token adapter', '@Inject(REFRESH_TOKEN_REPOSITORY)'],
    ['credentials adapter', '@Inject(CREDENTIALS_REPOSITORY)'],
    ['auth service', '@Inject(CREDENTIALS_VERIFIER, JwtService, RefreshTokenService)'],
  ])('rejects a chapter whose %s loses explicit constructor injection metadata', (_name, metadata) => {
    // Given
    const readWithoutInjectionMetadata = (relativePath: string): string => {
      const content = read(relativePath);

      return relativePath === 'book/beginner/ch14-jwt.md'
        ? content.replace(metadata, '')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceJwtLearningPathModuleWiring(readWithoutInjectionMetadata);

    // Then
    expect(runGovernanceGuard).toThrow(/@Inject/);
  });

  it('rejects a chapter whose persistence adapter is registered as a bare class provider', () => {
    // Given
    const readWithBareClassProvider = (relativePath: string): string => {
      const content = read(relativePath);

      return relativePath === 'book/beginner/ch14-jwt.md'
        ? content.replace(
          "{\n      provide: REFRESH_TOKEN_STORE,\n      useClass: DatabaseRefreshTokenStore,\n      inject: [REFRESH_TOKEN_REPOSITORY],\n    },",
          'DatabaseRefreshTokenStore,',
        )
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceJwtLearningPathModuleWiring(readWithBareClassProvider);

    // Then
    expect(runGovernanceGuard).toThrow(/bare class provider/);
  });
});
