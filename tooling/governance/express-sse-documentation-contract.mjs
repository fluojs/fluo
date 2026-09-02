import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtimeAdapterGuides = [
  'apps/docs/content/docs/guides/runtime-adapters.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Express SSE documentation contract check failed: ${message}`);
  }
}

function expressSection(content, relativePath) {
  const matches = [...content.matchAll(/^## Express\s*$/gmu)];

  assert(
    matches.length === 1,
    `${relativePath} must include exactly one ## Express section; found ${matches.length}.`,
  );

  const sectionStart = matches[0].index;
  const nextSectionStart = content.indexOf('\n## ', sectionStart + 1);
  return content.slice(sectionStart, nextSectionStart === -1 ? undefined : nextSectionStart);
}

export function enforceExpressSseDocumentationContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of runtimeAdapterGuides) {
    const section = expressSection(readText(relativePath), relativePath);

    for (const requiredSnippet of [
      "import { Sse, SseResponse, type RequestContext } from '@fluojs/http';",
      "@Sse('events')",
      'async streamEvents(_input: undefined, context: RequestContext)',
      'new SseResponse(context)',
    ]) {
      assert(
        section.includes(requiredSnippet),
        `${relativePath} Express SSE example must include ${requiredSnippet}.`,
      );
    }

    assert(
      !section.includes('@Res()') && !section.includes('new SseResponse()'),
      `${relativePath} Express SSE example must not use the unsupported @Res() decorator or omit RequestContext.`,
    );
  }
}
