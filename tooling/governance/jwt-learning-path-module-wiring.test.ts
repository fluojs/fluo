import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigModule, ConfigService } from '../../packages/config/src/index.js';
import { Inject, Module } from '../../packages/core/src/index.js';
import { Controller, Post, RequestDto } from '../../packages/http/src/index.js';
import { JwtModule, JwtService, RefreshTokenService } from '../../packages/jwt/src/index.js';
import { compileModuleGraph } from '../../packages/runtime/src/module-graph.js';
import { describe, expect, it } from 'vitest';

import { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const semanticCheckTimeoutMs = 60_000;
const runtimeGraph = {
  compileModuleGraph,
  config: { ConfigModule, ConfigService },
  core: { Inject, Module },
  http: { Controller, Post, RequestDto },
  jwt: { JwtModule, JwtService, RefreshTokenService },
};
const persistenceProviders = `providers: [
    {
      provide: REFRESH_TOKEN_STORE,
      useClass: DatabaseRefreshTokenStore,
      inject: [REFRESH_TOKEN_REPOSITORY],
    },
    {
      provide: CREDENTIALS_VERIFIER,
      useClass: DatabaseCredentialsVerifier,
      inject: [CREDENTIALS_REPOSITORY],
    },
  ],`;
const reversedPersistenceProviders = `providers: [
    {
      provide: CREDENTIALS_VERIFIER,
      useClass: DatabaseCredentialsVerifier,
      inject: [CREDENTIALS_REPOSITORY],
    },
    {
      provide: REFRESH_TOKEN_STORE,
      useClass: DatabaseRefreshTokenStore,
      inject: [REFRESH_TOKEN_REPOSITORY],
    },
  ],`;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function replaceInLearningFile(
  markdown: string,
  learningFilePath: string,
  before: string,
  after: string,
): string {
  const header = `// ${learningFilePath}\n`;
  const sourceStart = markdown.indexOf(header);
  const sourceEnd = sourceStart < 0 ? -1 : markdown.indexOf('```', sourceStart);

  if (sourceStart < 0 || sourceEnd < 0) {
    throw new Error(`Missing learning file block: ${learningFilePath}`);
  }

  const source = markdown.slice(sourceStart, sourceEnd);
  const mutatedSource = source.replace(before, after);

  if (mutatedSource === source) {
    throw new Error(`Mutation target was not found in ${learningFilePath}: ${before}`);
  }

  return `${markdown.slice(0, sourceStart)}${mutatedSource}${markdown.slice(sourceEnd)}`;
}

describe('JWT Chapter 14 executable module wiring', () => {
  it.each([
    'book/beginner/ch14-jwt.md',
    'book/beginner/ch14-jwt.ko.md',
  ])(
    '%s resolves its complete learning path through tracked public source and the runtime module graph',
    async (_relativePath) => {
      // Given
      const readOnlyPath = (candidatePath: string): string => read(candidatePath);

      // When
      const typecheckLearningPath = enforceJwtLearningPathModuleWiring(readOnlyPath, runtimeGraph);

      // Then
      await expect(typecheckLearningPath).resolves.toBeUndefined();
    },
    semanticCheckTimeoutMs,
  );

  it.each([
    ['marks AuthPersistenceModule as non-global', 'global: true,', 'global: false,'],
    ['removes REFRESH_TOKEN_STORE from module exports', 'exports: [REFRESH_TOKEN_STORE, CREDENTIALS_VERIFIER],', 'exports: [CREDENTIALS_VERIFIER],'],
    ['adds an extra persistence provider', 'providers: [\n    {', 'providers: [\n    AuthService,\n    {'],
    ['reorders the persistence providers', persistenceProviders, reversedPersistenceProviders],
    ['binds the refresh store under the repository token', 'provide: REFRESH_TOKEN_STORE,', 'provide: REFRESH_TOKEN_REPOSITORY,'],
    ['binds the credential verifier under the repository token', 'provide: CREDENTIALS_VERIFIER,', 'provide: CREDENTIALS_REPOSITORY,'],
    ['omits ConfigModule.forRoot from AuthModule imports', '    ConfigModule.forRoot(),\n', ''],
    ['omits AuthPersistenceModule from AuthModule imports', '    AuthPersistenceModule,\n', ''],
    ['replaces the asynchronous JWT module result', 'JwtModule.forRootAsync({', 'JwtModule.forRoot({'],
    ['drops AuthService from providers', 'providers: [AuthService],', 'providers: [],'],
    ['drops AuthController from controllers', 'controllers: [AuthController],', 'controllers: [],'],
    ['reorders the JWT factory injection tokens', '[ConfigService, REFRESH_TOKEN_STORE]', '[REFRESH_TOKEN_STORE, ConfigService]'],
    ['drops REFRESH_TOKEN_STORE from the JWT factory injection tokens', '[ConfigService, REFRESH_TOKEN_STORE]', '[ConfigService]'],
    ['returns a replacement refresh store from the JWT factory', '            store,\n', '            store: {} as RefreshTokenStore,\n'],
  ])(
    'rejects a chapter that %s',
    async (_name, before, after) => {
      // Given
      const readWithMutation = (relativePath: string): string =>
        relativePath === 'book/beginner/ch14-jwt.md'
          ? replaceInLearningFile(read(relativePath), 'src/auth/auth.module.ts', before, after)
          : read(relativePath);

      // When
      const runGovernanceGuard = enforceJwtLearningPathModuleWiring(
        readWithMutation,
        runtimeGraph,
      );

      // Then
      await expect(runGovernanceGuard).rejects.toThrow(
        /JWT learning-path module wiring check failed/,
      );
    },
    semanticCheckTimeoutMs,
  );

  it.each([
    [
      'refresh-token repository bootstrap binding',
      '      provide: REFRESH_TOKEN_REPOSITORY,\n      useValue: refreshTokenRepository satisfies RefreshTokenRepository,\n',
    ],
    [
      'credentials repository bootstrap binding',
      '      provide: CREDENTIALS_REPOSITORY,\n      useValue: credentialsRepository satisfies CredentialsRepository,\n',
    ],
  ])(
    'rejects a chapter without its %s',
    async (_name, binding) => {
      // Given
      const readWithoutBootstrapBinding = (relativePath: string): string =>
        relativePath === 'book/beginner/ch14-jwt.md'
          ? read(relativePath).replace(binding, '')
          : read(relativePath);

      // When
      const runGovernanceGuard = enforceJwtLearningPathModuleWiring(
        readWithoutBootstrapBinding,
        runtimeGraph,
      );

      // Then
      await expect(runGovernanceGuard).rejects.toThrow(/bootstrap repository binding/);
    },
    semanticCheckTimeoutMs,
  );

  it(
    'rejects a chapter whose auth service imports persistence symbols from the wrong module',
    async () => {
      // Given
      const readWithWrongPersistenceImport = (relativePath: string): string => {
        const content = read(relativePath);

        return relativePath === 'book/beginner/ch14-jwt.md'
          ? content.replace('} from \'./auth.persistence.js\';', '} from \'./auth.module.js\';')
          : content;
      };

      // When
      const runGovernanceGuard = enforceJwtLearningPathModuleWiring(
        readWithWrongPersistenceImport,
        runtimeGraph,
      );

      // Then
      await expect(runGovernanceGuard).rejects.toThrow(/auth\.module\.js/);
    },
    semanticCheckTimeoutMs,
  );

  it.each([
    ['refresh-token adapter', '@Inject(REFRESH_TOKEN_REPOSITORY)'],
    ['credentials adapter', '@Inject(CREDENTIALS_REPOSITORY)'],
    ['auth service', '@Inject(CREDENTIALS_VERIFIER, JwtService, RefreshTokenService)'],
  ])(
    'rejects a chapter whose %s loses explicit constructor injection metadata',
    async (_name, metadata) => {
      // Given
      const readWithoutInjectionMetadata = (relativePath: string): string => {
        const content = read(relativePath);

        return relativePath === 'book/beginner/ch14-jwt.md'
          ? content.replace(metadata, '')
          : content;
      };

      // When
      const runGovernanceGuard = enforceJwtLearningPathModuleWiring(
        readWithoutInjectionMetadata,
        runtimeGraph,
      );

      // Then
      await expect(runGovernanceGuard).rejects.toThrow(/@Inject/);
    },
    semanticCheckTimeoutMs,
  );

  it(
    'rejects a chapter whose persistence adapter is registered as a bare class provider',
    async () => {
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
      const runGovernanceGuard = enforceJwtLearningPathModuleWiring(
        readWithBareClassProvider,
        runtimeGraph,
      );

      // Then
      await expect(runGovernanceGuard).rejects.toThrow(/bare class provider/);
    },
    semanticCheckTimeoutMs,
  );
});
