import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const requirements = [
  [
    'book/beginner/ch14-jwt.md',
    [
      'export class AuthPersistenceModule',
      'global: true',
      'provide: REFRESH_TOKEN_STORE',
      'useExisting: DatabaseRefreshTokenStore',
      'provide: CREDENTIALS_VERIFIER',
      'useExisting: DatabaseCredentialsVerifier',
      'exports: [REFRESH_TOKEN_STORE, CREDENTIALS_VERIFIER]',
      'ConfigModule.forRoot()',
      'inject: [ConfigService, REFRESH_TOKEN_STORE]',
      'providers: [AuthService]',
      'controllers: [AuthController]',
    ],
  ],
  [
    'book/beginner/ch14-jwt.ko.md',
    [
      'export class AuthPersistenceModule',
      'global: true',
      'provide: REFRESH_TOKEN_STORE',
      'useExisting: DatabaseRefreshTokenStore',
      'provide: CREDENTIALS_VERIFIER',
      'useExisting: DatabaseCredentialsVerifier',
      'exports: [REFRESH_TOKEN_STORE, CREDENTIALS_VERIFIER]',
      'ConfigModule.forRoot()',
      'inject: [ConfigService, REFRESH_TOKEN_STORE]',
      'providers: [AuthService]',
      'controllers: [AuthController]',
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.md',
    ['AuthPersistenceModule', 'ConfigModule.forRoot()', 'REFRESH_TOKEN_STORE', 'CREDENTIALS_VERIFIER'],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    ['AuthPersistenceModule', 'ConfigModule.forRoot()', 'REFRESH_TOKEN_STORE', 'CREDENTIALS_VERIFIER'],
  ],
  [
    'docs/CONTEXT.md',
    ['AuthPersistenceModule', 'ConfigModule.forRoot()', './getting-started/migrate-from-nestjs.md', '../book/beginner/ch14-jwt.md'],
  ],
  [
    'docs/CONTEXT.ko.md',
    ['AuthPersistenceModule', 'ConfigModule.forRoot()', './getting-started/migrate-from-nestjs.ko.md', '../book/beginner/ch14-jwt.ko.md'],
  ],
];

function fail(relativePath, missing) {
  throw new Error(
    `JWT learning-path module wiring check failed: ${relativePath} must include ${missing}.`,
  );
}

/**
 * Ensures the Chapter 14 learning path remains an executable application graph
 * across its EN/KO chapter, migration guidance, and AI-context entrypoints.
 */
export function enforceJwtLearningPathModuleWiring(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, fragments] of requirements) {
    const content = readText(relativePath);

    for (const fragment of fragments) {
      if (!content.includes(fragment)) {
        fail(relativePath, `\`${fragment}\``);
      }
    }
  }
}
