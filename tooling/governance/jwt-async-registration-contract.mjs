import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceJwtAsyncRegistrationSourceContract } from './jwt-async-registration-source-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const governedDocuments = [
  ['packages/jwt/README.md', 'en'],
  ['packages/jwt/README.ko.md', 'ko'],
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
  ['book/beginner/ch14-jwt.md', 'en'],
  ['book/beginner/ch14-jwt.ko.md', 'ko'],
  ['docs/CONTEXT.md', 'en'],
  ['docs/CONTEXT.ko.md', 'ko'],
];

function fail(relativePath, message) {
  throw new Error(`JWT async registration contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
}

function clauses(content) {
  return content
    .split(/(?<=[.!。！])\s+|\n+/u)
    .map((clause) => clause.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function visibleMarkdown(content) {
  const visibleLines = [];
  let fence;

  for (const line of content.split(/\r?\n/u)) {
    const marker = /^(?: {0,3})(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence === undefined) {
      if (marker === undefined) {
        visibleLines.push(line);
      } else {
        fence = marker;
      }
      continue;
    }
    if (marker?.[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined;
    }
  }

  return visibleLines.join('\n').replace(/<!--[\s\S]*?-->/gu, '');
}

function hasAll(value, patterns) {
  return patterns.every((pattern) => pattern.test(value));
}

function requiredGuidance(content, locale) {
  const documentClauses = clauses(content);
  const localePatterns = locale === 'en'
    ? {
        graphTiming: /\b(?:already|before|first|pre-register\w*)\b/iu,
        negative: /\b(?:does not|do not|not accepted|not part|no|never|unsupported|outside)\b/iu,
        returnAction: /\b(?:returns?|returned)\b/iu,
      }
    : {
        graphTiming: /(?:먼저|사전에|이미|전에)/u,
        negative: /(?:지원하지|허용하지|받지|포함되지|아니|없|금지|거부)/u,
        returnAction: /(?:반환)/u,
      };
  const actor = /JwtModule\.forRootAsync/u;

  return {
    discoveryBoundary: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:implicit|automatic|암묵적|자동)/iu,
      /(?:module|provider)/iu,
      /(?:discover|discovery|scan|탐색|발견)/iu,
      localePatterns.negative,
    ])),
    finalOptions: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:useFactory|factory)/u,
        /(?:final|최종) `?(?:JWT options?|JwtVerifierOptions)/iu,
      localePatterns.returnAction,
    ])),
    graphRegistration: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:dependencies?|providers?|의존성|provider)/iu,
      /application (?:module )?graph/iu,
      /(?:register|등록)/iu,
      localePatterns.graphTiming,
    ])),
    rejectedNestjsFields: documentClauses.some((clause) => hasAll(clause, [
      /imports/u,
      /useClass/u,
      /useExisting/u,
      localePatterns.negative,
    ])),
    supportedShape: documentClauses.some((clause) => hasAll(clause, [actor, /inject/u, /useFactory/u, /global\?/u])),
    dependencyVisibility: documentClauses.some((clause) => locale === 'en'
      ? hasAll(clause, [
          /(?:global module|module that exports?)/iu,
          /parent module(?:'s)? providers?/iu,
          /(?:not visible|cannot inject)/iu,
        ])
      : hasAll(clause, [
          /(?:global module|export.*module|module.*export)/iu,
          /parent module providers?/iu,
          /(?:보이지 않|주입할 수 없)/u,
        ])),
    globalBoundary: documentClauses.some((clause) => hasAll(clause, [
      /global\?/u,
      /(?:top-level|최상위)/iu,
      /(?:visible|visibility|노출|가시성)/iu,
      /`?JwtVerifierOptions/u,
      /useFactory/u,
      localePatterns.returnAction,
    ])),
  };
}

function unsupportedFieldsAreSupported(proposition, locale, patterns) {
  if (locale === 'en') {
    return (
      patterns.positive.test(proposition) && !patterns.negative.test(proposition)
    ) || /\b(?:is|are)\s+not\s+unsupported\b/iu.test(proposition)
      || /\bneither\b[\s\S]*\b(?:is|are)\s+unsupported\b/iu.test(proposition);
  }

  return (
    patterns.positive.test(proposition) && !patterns.negative.test(proposition)
  ) || /지원하지\s*않는\s*것은\s*아닙니다?/u.test(proposition);
}

function contradictionMessage(content, locale) {
  const languagePatterns = locale === 'en'
    ? {
        negative: /\b(?:cannot|does not|do not|never|no|neither|nor|not accepted|not supported|unsupported|outside)\b/iu,
        positive: /\b(?:accept(?:s|ed)?|allows?|supports?|permits?|takes?|valid|available|can use|may use|ignored)\b/iu,
      }
    : {
        negative: /(?:지원하지|허용하지|받지|사용할 수 없|포함되지|아니|없|금지|거부)/u,
      positive: /(?:지원합니다|지원한다|지원됩니다|허용합니다|받는다|사용할 수 있|유효|무시)/u,
      };
  const actor = /(?:JwtModule\.forRootAsync|fluo JWT async registration|JWT async registration)/iu;
  const forbiddenField = /(?:imports|useClass|useExisting)/u;
  const discoveryMode = /(?:implicit|automatic|암묵적|자동)/iu;
  const discoveryTarget = /(?:module|provider)/iu;
  const discoveryAction = /(?:discover|discovery|scan|탐색|발견)/iu;

  for (const clause of clauses(content)) {
    if (!actor.test(clause)) {
      continue;
    }
    const connectiveParts = clause.split(
      /;\s*(?:however\s+)?|(?:,\s*|\s+)(?:and|but|however|yet|while)\s+|(?:하지만|그러나|반면|지만|않으며)[,\s]*/iu,
    );
    const propositions = connectiveParts.flatMap((proposition) =>
      languagePatterns.negative.test(proposition) && languagePatterns.positive.test(proposition)
        ? proposition.split(/,\s*/u)
        : [proposition]);

    for (const proposition of propositions) {
      const isNegative = languagePatterns.negative.test(proposition);
      if (forbiddenField.test(proposition) && unsupportedFieldsAreSupported(proposition, locale, languagePatterns)) {
        return 'must not claim that NestJS imports/useClass/useExisting fields are accepted, usable, or ignored.';
      }
      const parentLocalProvider = locale === 'en'
        ? /parent module(?:'s)? providers?/iu.test(proposition)
          && (/can inject/iu.test(proposition) || (/\bvisible\b/iu.test(proposition) && !/\bnot visible\b/iu.test(proposition)))
        : /부모 module providers?/u.test(proposition) && /(?:주입할 수 있|보입니다|보인다)/u.test(proposition);
      if (parentLocalProvider) {
        return 'must not claim parent-local providers are visible to the JWT options provider.';
      }
      const doubleNegativeDiscovery = locale === 'en'
        ? /\b(?:does not|do not)\s+(?:disable|prevent|block|stop)\b/iu.test(proposition)
        : /(?:비활성화하지|막지|차단하지|방지하지)\s*않/u.test(proposition);
      if (
        discoveryMode.test(proposition) &&
        discoveryTarget.test(proposition) &&
        discoveryAction.test(proposition) &&
        (!isNegative || doubleNegativeDiscovery)
      ) {
        return 'must not claim implicit module or provider discovery.';
      }
    }
  }

  return undefined;
}

export function enforceJwtAsyncRegistrationContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceJwtAsyncRegistrationSourceContract(readText);

  for (const [relativePath, locale] of governedDocuments) {
    const content = visibleMarkdown(readText(relativePath));
    const guidance = requiredGuidance(content, locale);
    const missing = Object.entries(guidance)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    assert(
      missing.length === 0,
      relativePath,
      `must document the source-backed injected-factory boundary; missing ${missing.join(', ')}`,
    );
    const contradiction = contradictionMessage(content, locale);
    assert(!contradiction, relativePath, contradiction ?? 'must remain contradiction-free');
  }
}
