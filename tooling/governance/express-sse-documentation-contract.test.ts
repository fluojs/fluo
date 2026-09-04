import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { enforceExpressSseDocumentationContract } from './express-sse-documentation-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function addUnsupportedResDecorator(content: string): {
  readonly content: string;
  readonly mutations: number;
} {
  const sseCodeBlocks = [...content.matchAll(/```(?:typescript|ts)\s*\n([\s\S]*?)```/gu)].filter(
    (match) => /@Sse\s*\(/u.test(match[1] ?? ''),
  );

  if (sseCodeBlocks.length !== 1) {
    throw new Error(`Expected exactly one TypeScript SSE code block; found ${sseCodeBlocks.length}.`);
  }

  const sseCodeBlock = sseCodeBlocks[0];
  if (sseCodeBlock === undefined) {
    throw new Error('Expected a TypeScript SSE code block.');
  }

  const example = sseCodeBlock[1] ?? '';
  const sseDeclarations = [...example.matchAll(/^(?<indent>[ \t]*)@Sse\s*\([^)\r\n]*\)\s*$/gmu)];
  if (sseDeclarations.length !== 1) {
    throw new Error(`Expected exactly one @Sse declaration; found ${sseDeclarations.length}.`);
  }

  const sseDeclaration = sseDeclarations[0];
  if (sseDeclaration === undefined || sseDeclaration.index === undefined || sseCodeBlock.index === undefined) {
    throw new Error('Expected an indexed @Sse declaration in the TypeScript SSE code block.');
  }

  const exampleStart = sseCodeBlock.index + sseCodeBlock[0].indexOf(example);
  const decoratorStart = exampleStart + sseDeclaration.index;
  const indent = sseDeclaration.groups?.indent ?? '';

  return {
    content: `${content.slice(0, decoratorStart)}${indent}@Res()\n${content.slice(decoratorStart)}`,
    mutations: 1,
  };
}

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

  it.each([
    ['English', 'apps/docs/content/docs/guides/runtime-adapters.mdx'],
    ['Korean', 'apps/docs/content/docs/guides/runtime-adapters.ko.mdx'],
  ])('rejects an additive @Res decorator in the %s runtime-adapter example', (_locale, targetPath) => {
    const mutation = addUnsupportedResDecorator(readFileSync(join(repoRoot, targetPath), 'utf8'));
    expect(mutation.mutations).toBe(1);

    const readText = (relativePath: string): string => {
      return relativePath === targetPath
        ? mutation.content
        : readFileSync(join(repoRoot, relativePath), 'utf8');
    };

    expect(() => enforceExpressSseDocumentationContract(readText)).toThrow(
      /must not use the unsupported @Res\(\) decorator/u,
    );
  });

  it('rejects a valid RequestContext and SseResponse shape on an unrelated helper', () => {
    const readText = (): string =>
      [
        '## Express',
        '',
        '```ts',
        "import { type RequestContext, SseResponse, Sse } from '@fluojs/http';",
        '',
        "@Sse('/live-events')",
        'streamLiveFeed(_input: undefined) {',
        '  return new SseResponse();',
        '}',
        '',
        'function createSseResponse(_input: undefined, requestContext: RequestContext) {',
        '  return new SseResponse(requestContext);',
        '}',
        '```',
      ].join('\n');

    expect(() => enforceExpressSseDocumentationContract(readText)).toThrow(
      /SSE handler must accept RequestContext as its second parameter/u,
    );
  });
});
