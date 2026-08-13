import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceAdapterOwnedApplicationSource } from './express-application-ownership-source.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const adapterSourcePath = 'packages/platform-express/src/adapter.ts';
const governedDocuments = [
  ['packages/platform-express/README.md', 'en'],
  ['packages/platform-express/README.ko.md', 'ko'],
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
  ['book/intermediate/ch21-express-node.md', 'en'],
  ['book/intermediate/ch21-express-node.ko.md', 'ko'],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', 'en'],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', 'ko'],
  ['docs/reference/package-surface.md', 'en'],
  ['docs/reference/package-surface.ko.md', 'ko'],
  ['docs/reference/package-chooser.md', 'en'],
  ['docs/reference/package-chooser.ko.md', 'ko'],
  ['docs/CONTEXT.md', 'en'],
  ['docs/CONTEXT.ko.md', 'ko'],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Express application ownership contract check failed: ${message}`);
  }
}

function clauses(content) {
  return content
    .split(/(?<=[.!?;。！？；])\s+|\n+/u)
    .map((clause) => clause.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function hasAll(clause, patterns) {
  return patterns.every((pattern) => pattern.test(clause));
}

function findGuidance(content, locale) {
  const documentClauses = clauses(content);
  const languagePatterns = locale === 'en'
    ? {
        adoptionAction: /\b(?:adopt|accept|attach|pass|reuse|supply)\w*\b/iu,
        constructionTime: /\b(?:construction-time|at construction time|during adapter construction|when the adapter is (?:created|constructed))\b/iu,
        lateBoundary: /\b(?:after\s+bootstrap|post-bootstrap)\b/iu,
        negative: /\b(?:cannot|does not|do not|never|no|not (?:a )?supported|unsupported)\b/iu,
        portableAction: /\b(?:prefer|rewrite|rewritten|move)\w*\b/iu,
      }
    : {
        adoptionAction: /(?:채택|전달|연결|재사용|받)/u,
        constructionTime: /(?:construction-time|adapter (?:생성|구성) 시점|adapter를 (?:생성|구성)할 때)/u,
        lateBoundary: /(?:bootstrap (?:이후|후)|post-bootstrap)/u,
        negative: /(?:지원하지|할 수 없|불가|금지|아니|않|없)/u,
        portableAction: /(?:우선|재작성|옮기|바꾸)/u,
      };
  const existingApplication = locale === 'en'
    ? /existing Express (?:app(?:lication)?)/iu
    : /기존 Express (?:app(?:lication)?)/iu;
  const nativeMiddleware = /`?nativeMiddleware`?/u;
  const nativeUse = /`?use\(\.\.\.\)`?/u;
  const portableMiddleware = /fluo `Middleware`/u;

  return {
    adoption: documentClauses.some((clause) =>
      hasAll(clause, [existingApplication, languagePatterns.adoptionAction, languagePatterns.negative])),
    construction: documentClauses.some((clause) =>
      hasAll(clause, [nativeMiddleware, languagePatterns.constructionTime])),
    lateMutation: documentClauses.some((clause) =>
      hasAll(clause, [nativeUse, languagePatterns.lateBoundary, languagePatterns.negative])),
    portability: documentClauses.some((clause) =>
      hasAll(clause, [portableMiddleware, languagePatterns.portableAction])),
  };
}

function contradictionMessage(content, locale) {
  const existingApplication = locale === 'en'
    ? /existing Express (?:app(?:lication)?)/iu
    : /기존 Express (?:app(?:lication)?)/iu;
  const languagePatterns = locale === 'en'
    ? {
        adoptionAction: /\b(?:adopt|accept|attach|pass|reuse|supply)\w*\b/iu,
        lateAction: /\b(?:append|attach|call|mutate|register|use)\w*\b/iu,
        negative: /\b(?:cannot|does not|do not|never|no|not supported|unsupported)\b/iu,
        positive: /\b(?:allows?|can|may|supports?|is available|is supported)\b/iu,
      }
    : {
        adoptionAction: /(?:채택|전달|연결|재사용|받)/u,
        lateAction: /(?:추가|연결|호출|변경|등록|사용)/u,
        negative: /(?:지원하지|할 수 없|불가|금지|아니|않|없)/u,
        positive: /(?:할 수 있|지원(?:합니다|된다|됩니다)|허용|가능)/u,
      };

  for (const clause of clauses(content)) {
    const connectivePropositions = clause.split(/(?:,\s*|\s+)(?:but|however|yet)\s+|(?<=지만)\s*/iu);
    const propositions = connectivePropositions.flatMap((proposition) =>
      languagePatterns.negative.test(proposition) && languagePatterns.positive.test(proposition)
        ? proposition.split(/,\s*/u)
        : [proposition],
    );
    for (const proposition of propositions) {
      const isNegative = languagePatterns.negative.test(proposition);
      if (
        existingApplication.test(proposition) &&
        languagePatterns.adoptionAction.test(proposition) &&
        languagePatterns.positive.test(proposition) &&
        !isNegative
      ) {
        return 'must not claim that an existing Express application can be adopted.';
      }
      if (
        /(?:\b(?:after\s+bootstrap|post-bootstrap)\b|bootstrap (?:이후|후))/iu.test(proposition) &&
        /`?use\(\.\.\.\)`?/u.test(proposition) &&
        languagePatterns.lateAction.test(proposition) &&
        languagePatterns.positive.test(proposition) &&
        !isNegative
      ) {
        return 'must not claim that native middleware can be appended after bootstrap through use(...).';
      }
    }
  }

  return undefined;
}

export function enforceExpressApplicationOwnershipDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceAdapterOwnedApplicationSource(readText(adapterSourcePath), adapterSourcePath);

  for (const [relativePath, locale] of governedDocuments) {
    const content = readText(relativePath);
    const guidance = findGuidance(content, locale);
    const missing = Object.entries(guidance)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    assert(
      missing.length === 0,
      `${relativePath} must document adapter-owned Express application construction, construction-time nativeMiddleware, unsupported post-bootstrap use(...), and portable fluo Middleware guidance; missing ${missing.join(', ')}.`,
    );

    const contradiction = contradictionMessage(content, locale);
    assert(!contradiction, `${relativePath} ${contradiction ?? ''}`);
  }
}
