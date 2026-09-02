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

function expressSseHandler(example, relativePath) {
  const handlers = [
    ...example.matchAll(
      /^(?<indent>[ \t]*)@Sse\s*\(\s*[^)\s][^)]*\)\s*\r?\n(?<signature>(?:async\s+)?[A-Za-z_$][\w$]*\s*\((?<parameters>[\s\S]*?)\)\s*(?::[^{\r\n]+)?\{)(?<body>[\s\S]*?)^\k<indent>\}/gmu,
    ),
  ];

  assert(
    handlers.length === 1,
    `${relativePath} Express SSE example must declare exactly one @Sse-decorated handler; found ${handlers.length}.`,
  );

  return handlers[0];
}

export function enforceExpressSseDocumentationContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of runtimeAdapterGuides) {
    const section = expressSection(readText(relativePath), relativePath);
    const example = expressSseCodeExample(section, relativePath);
    const sseHandler = expressSseHandler(example, relativePath);
    const parameters = sseHandler?.groups?.parameters ?? '';
    const requestContextParameter = /^\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*:\s*RequestContext\b/u.exec(parameters);
    assert(
      requestContextParameter !== null,
      `${relativePath} Express SSE handler must accept RequestContext as its second parameter.`,
    );

    const requestContextName = requestContextParameter[1];
    const body = sseHandler?.groups?.body ?? '';
    const responseContextPattern = new RegExp(
      `new\\s+SseResponse\\s*\\(\\s*${requestContextName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\)`,
      'u',
    );

    assert(
      responseContextPattern.test(body),
      `${relativePath} Express SSE handler must pass its RequestContext parameter to new SseResponse(...).`,
    );
    assert(
      !/@Res\s*\(/u.test(example),
      `${relativePath} Express SSE example must not use the unsupported @Res() decorator.`,
    );
  }
}
