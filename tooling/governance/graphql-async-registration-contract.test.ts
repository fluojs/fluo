import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { enforceGraphqlAsyncRegistrationContract } from './graphql-async-registration-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('GraphQL async registration contract', () => {
  it('keeps the injected async registration source and documentation contract synchronized', () => {
    expect(() => enforceGraphqlAsyncRegistrationContract()).not.toThrow();
  });

  it('rejects a registration provider that does not receive the runtime container', () => {
    const readWithoutRuntimeContainer = (relativePath: string): string =>
      relativePath === 'packages/graphql/src/module.ts'
        ? read(relativePath).replace('inject: [RUNTIME_CONTAINER],', 'inject: [],')
        : read(relativePath);

    expect(() => enforceGraphqlAsyncRegistrationContract(readWithoutRuntimeContainer)).toThrow(
      /runtime-container options provider/u,
    );
  });

  it('rejects documentation that no longer names the async registration entrypoint', () => {
    const readWithoutEntryPoint = (relativePath: string): string =>
      relativePath === 'docs/CONTEXT.md'
        ? read(relativePath).replace('GraphqlModule.forRootAsync', 'GraphqlModule.forRootDeferred')
        : read(relativePath);

    expect(() => enforceGraphqlAsyncRegistrationContract(readWithoutEntryPoint)).toThrow(
      'docs/CONTEXT.md',
    );
  });
});
