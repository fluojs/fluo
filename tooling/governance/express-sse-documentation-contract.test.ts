import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { enforceExpressSseDocumentationContract } from './express-sse-documentation-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Express SSE documentation contract', () => {
  it('requires bilingual runtime-adapter examples to use the shipped handler contract', () => {
    expect(() => enforceExpressSseDocumentationContract()).not.toThrow();
  });

  it('rejects a NestJS-style response decorator in either runtime-adapter guide', () => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === 'apps/docs/content/docs/guides/runtime-adapters.ko.mdx'
        ? content.replace("@Sse('events')", '@Res()')
        : content;
    };

    expect(() => enforceExpressSseDocumentationContract(readText)).toThrow(
      /must include @Sse\('events'\)/u,
    );
  });
});
