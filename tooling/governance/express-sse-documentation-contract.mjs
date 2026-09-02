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

function expressSseCodeExample(section, relativePath) {
  const examples = [...section.matchAll(/```(?:typescript|ts)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter((example) => /@Sse\s*\(/u.test(example));

  assert(
    examples.length === 1,
    `${relativePath} Express section must include exactly one TypeScript SSE code example; found ${examples.length}.`,
  );

  return examples[0];
}

export function enforceExpressSseDocumentationContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of runtimeAdapterGuides) {
    const section = expressSection(readText(relativePath), relativePath);
    const example = expressSseCodeExample(section, relativePath);

    assert(
      /@Sse\s*\(\s*[^)\s][^)]*\)/u.test(example),
      `${relativePath} Express SSE example must declare an @Sse route.`,
    );

    const requestContextParameter = /(?:async\s+)?[A-Za-z_$][\w$]*\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*:\s*RequestContext\b/u.exec(example);
    assert(
      requestContextParameter !== null,
      `${relativePath} Express SSE example must accept RequestContext as its second parameter.`,
    );

    const requestContextName = requestContextParameter[1];
    const responseContextPattern = new RegExp(
      `new\\s+SseResponse\\s*\\(\\s*${requestContextName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\)`,
      'u',
    );

    assert(
      responseContextPattern.test(example),
      `${relativePath} Express SSE example must pass its RequestContext parameter to new SseResponse(...).`,
    );
    assert(
      !/@Res\s*\(/u.test(example),
      `${relativePath} Express SSE example must not use the unsupported @Res() decorator.`,
    );
  }
}
