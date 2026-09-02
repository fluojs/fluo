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

  it('accepts arbitrary SSE paths and handler identifiers while ignoring @Res prose', () => {
    const readText = (): string =>
      [
        '## Express',
        '',
        '`@Res()` is unsupported for this handler.',
        '',
        '```ts',
        "import { type RequestContext, SseResponse, Sse } from '@fluojs/http';",
        '',
        "@Sse('/live-events')",
        'streamLiveFeed(_input: undefined, requestContext: RequestContext) {',
        '  return new SseResponse(requestContext);',
        '}',
        '```',
      ].join('\n');

    expect(() => enforceExpressSseDocumentationContract(readText)).not.toThrow();
  });

  it('rejects an additive @Res decorator in the English runtime-adapter example', () => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === 'apps/docs/content/docs/guides/runtime-adapters.mdx'
        ? content.replace("@Sse('events')", "@Res()\n@Sse('events')")
        : content;
    };

    expect(() => enforceExpressSseDocumentationContract(readText)).toThrow(
      /must not use the unsupported @Res\(\) decorator/u,
    );
  });

  it('rejects an additive @Res decorator in the Korean runtime-adapter example', () => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === 'apps/docs/content/docs/guides/runtime-adapters.ko.mdx'
        ? content.replace("@Sse('events')", "@Res()\n@Sse('events')")
        : content;
    };

    expect(() => enforceExpressSseDocumentationContract(readText)).toThrow(
      /must not use the unsupported @Res\(\) decorator/u,
    );
  });
});
