import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationBoundaryRequirements = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    heading: '## GraphQL Migration Boundaries',
    claims: [
      'NestJS resolver guards and `GqlExecutionContext` do not transfer to `@fluojs/graphql`.',
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
      '`GraphqlModule`은 GraphQL HTTP endpoint를 고정된 `/graphql` path에 mount합니다.',
      '모든 resolver decorator는 public instance member를 대상으로 합니다.',
      'Root `outputType`은 추론되지 않습니다.',
      "Request-scoped provider를 주입하는 resolver에는 반드시 `@Scope('request')`를 붙여야 합니다.",
      'Application은 typed `AsyncIterable`을 반환하고 GraphQL이 소비를 멈출 때 application resource를 닫아야 합니다.',
    ],
  },
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

function enforceSectionClaims(content, requirement) {
  const section = extractSection(content, requirement.heading, requirement.path);
  const missingClaims = requirement.claims.filter((claim) => !section.includes(claim));
  assert(
    missingClaims.length === 0,
    `${requirement.path} ${requirement.heading} must retain explicit GraphQL migration claim(s): ${missingClaims.join(', ')}.`,
  );
}

function enforceDiscoverabilityLink(content, requirement) {
  const occurrences = content.split('\n').filter((line) => line.includes(requirement.link));
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
