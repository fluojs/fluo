import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const englishAuthenticationClaim =
  'Application middleware registered before `GraphqlModule` must establish `requestContext.principal`; GraphQL HTTP route guards registered after it do not run because `GraphqlLifecycleService` handles `/graphql` without calling `next()`.';
const koreanAuthenticationClaim =
  '`GraphqlModule`보다 먼저 등록된 application middleware가 `requestContext.principal`을 설정해야 합니다. `GraphqlLifecycleService`가 `next()`를 호출하지 않고 `/graphql`을 처리하므로 그 뒤에 등록된 GraphQL HTTP route guard는 실행되지 않습니다.';
const migrationBoundaryRequirements = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    heading: '## GraphQL Migration Boundaries',
    claims: [
      'NestJS resolver guards and `GqlExecutionContext` do not transfer to `@fluojs/graphql`.',
      englishAuthenticationClaim,
      '`GraphqlModule` mounts the GraphQL HTTP endpoint at the fixed `/graphql` path.',
      'All resolver decorators target public instance members:',
      'Root `outputType` is never inferred:',
      "Resolvers that inject request-scoped providers must themselves use `@Scope('request')`.",
      'the application must return a typed `AsyncIterable` and close application resources when GraphQL stops consuming it.',
    ],
  },
  {
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    heading: '## GraphQL 마이그레이션 경계',
    claims: [
      'NestJS resolver guard와 `GqlExecutionContext`는 `@fluojs/graphql`로 이전되지 않습니다.',
      koreanAuthenticationClaim,
      '`GraphqlModule`은 GraphQL HTTP endpoint를 고정된 `/graphql` path에 mount합니다.',
      '모든 resolver decorator는 public instance member를 대상으로 합니다.',
      'Root `outputType`은 추론되지 않습니다.',
      "Request-scoped provider를 주입하는 resolver에는 반드시 `@Scope('request')`를 붙여야 합니다.",
      'Application은 typed `AsyncIterable`을 반환하고 GraphQL이 소비를 멈출 때 application resource를 닫아야 합니다.',
    ],
  },
  {
    path: 'book/intermediate/ch18-graphql.md',
    heading: '### NestJS Migration Boundaries',
    claims: [englishAuthenticationClaim],
  },
  {
    path: 'book/intermediate/ch18-graphql.ko.md',
    heading: '### NestJS 마이그레이션 경계',
    claims: [koreanAuthenticationClaim],
  },
];
const obsoleteAuthorizationGuidance = [
  /\b(?:application-owned\s+)?middleware\s+or\s+(?:HTTP\s+route\s+)?guards?\b/iu,
  /\bGraphQL HTTP route guards?\s+(?:can|may|should|must|will)\b/iu,
  /middleware\s*또는\s*(?:HTTP\s+route\s+)?guard/iu,
  /GraphQL HTTP route guard(?:는|가)?\s*(?:실행(?!되지)|인증)/iu,
];
const discoverabilityRequirements = [
  {
    path: 'docs/CONTEXT.md',
    link: '[GraphQL Migration Boundaries](./getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  },
  {
    path: 'docs/CONTEXT.ko.md',
    link: '[GraphQL 마이그레이션 경계](./getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  },
  {
    path: 'packages/graphql/README.md',
    link: '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  },
  {
    path: 'packages/graphql/README.ko.md',
    link: '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function renderedMarkdown(content) {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/gu, '');
  const renderedLines = [];
  let fence;

  for (const line of withoutComments.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];

    if (fence === undefined && marker !== undefined) {
      fence = marker;
      continue;
    }

    if (
      fence !== undefined &&
      new RegExp(`^\\s{0,3}${escapeRegExp(fence[0])}{${String(fence.length)},}\\s*$`, 'u').test(line)
    ) {
      fence = undefined;
      continue;
    }

    if (fence === undefined) {
      renderedLines.push(line);
    }
  }

  return renderedLines.join('\n');
}

function extractSection(content, heading, relativePath) {
  const headings = content.split('\n').filter((line) => line === heading);
  assert(
    headings.length === 1,
    `${relativePath} must include exactly one ${heading}; found ${headings.length}.`,
  );

  const start = content.indexOf(heading);
  const headingLevel = /^#+/u.exec(heading)?.[0].length;
  assert(headingLevel !== undefined, `${relativePath} heading ${heading} must be a Markdown heading.`);

  const remainder = content.slice(start + heading.length);
  const nextHeading = new RegExp(`\\n#{1,${headingLevel}}\\s`, 'u').exec(remainder);
  return remainder.slice(0, nextHeading?.index);
}

function hasAffirmativeClaim(section, claim) {
  const boundary = '(?:^|[.!?]\\s+|:\\s+|^[-*]\\s+)';
  return new RegExp(`${boundary}${escapeRegExp(claim)}`, 'mu').test(section);
}

function enforceSectionClaims(content, requirement) {
  const section = extractSection(renderedMarkdown(content), requirement.heading, requirement.path);
  const missingClaims = requirement.claims.filter((claim) => !hasAffirmativeClaim(section, claim));
  assert(
    missingClaims.length === 0,
    `${requirement.path} ${requirement.heading} must retain explicit GraphQL migration claim(s): ${missingClaims.join(', ')}.`,
  );
  const obsoleteClaim = obsoleteAuthorizationGuidance.find((pattern) => pattern.test(section));
  assert(
    obsoleteClaim === undefined,
    `${requirement.path} ${requirement.heading} must not recommend GraphQL HTTP route guards that run after GraphqlModule.`,
  );
}

function enforceDiscoverabilityLink(content, requirement) {
  const occurrences = [...renderedMarkdown(content).matchAll(new RegExp(escapeRegExp(requirement.link), 'gu'))];
  assert(
    occurrences.length === 1,
    `${requirement.path} must include exactly one canonical GraphQL migration link; found ${occurrences.length}.`,
  );
}

export function enforceGraphqlNestjsMigrationBoundaries(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const requirement of migrationBoundaryRequirements) {
    enforceSectionClaims(readText(requirement.path), requirement);
  }

  for (const requirement of discoverabilityRequirements) {
    enforceDiscoverabilityLink(readText(requirement.path), requirement);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceGraphqlNestjsMigrationBoundaries();
}
