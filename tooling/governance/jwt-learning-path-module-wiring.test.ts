import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('JWT Chapter 14 executable module wiring', () => {
  it.each([
    'book/beginner/ch14-jwt.md',
    'book/beginner/ch14-jwt.ko.md',
  ])('%s resolves its complete learning path through public package types', (relativePath) => {
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
});
