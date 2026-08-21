import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceJwtAsyncRegistrationContract } from './jwt-async-registration-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('JWT async registration migration table', () => {
  it.each([
    [
      'docs/getting-started/migrate-from-nestjs.md',
      "`JwtModule.forRootAsync(...)` dependencies can come from a module that exports them into `JwtRuntimeModule`'s application graph.",
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      '`JwtModule.forRootAsync(...)` 의존성은 `JwtRuntimeModule`의 application graph에 export하는 module에서 올 수 있습니다.',
    ],
  ] as const)('rejects stale module-export visibility guidance in %s', (targetPath, staleGuidance) => {
    // Given
    const readWithStaleGuidance = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${staleGuidance}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithStaleGuidance);

    // Then
    expect(runGovernanceGuard).toThrow(
      /must not claim a module export alone enters JwtRuntimeModule's application graph/,
    );
  });
});
