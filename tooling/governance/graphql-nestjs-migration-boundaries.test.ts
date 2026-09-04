import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforceGraphqlNestjsMigrationBoundaries } from './graphql-nestjs-migration-boundaries.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const englishMigrationPath = 'docs/getting-started/migrate-from-nestjs.md';
const koreanMigrationPath = 'docs/getting-started/migrate-from-nestjs.ko.md';
const englishBookPath = 'book/intermediate/ch18-graphql.md';
const koreanBookPath = 'book/intermediate/ch18-graphql.ko.md';
const englishReadmePath = 'packages/graphql/README.md';
const koreanReadmePath = 'packages/graphql/README.ko.md';
const englishAuthenticationClaim =
  'Only bootstrap/application middleware registered before GraphQL consumes a request can establish `requestContext.principal`; HTTP route guards registered after `GraphqlModule` do not run. Authorize each operation in its resolver using `context.principal`.';
const koreanAuthenticationClaim =
  'GraphQL이 request를 소비하기 전에 등록된 bootstrap/application middleware만 `requestContext.principal`을 설정할 수 있습니다. `GraphqlModule` 뒤에 등록된 HTTP route guard는 실행되지 않습니다. 각 operation의 resolver에서 `context.principal`로 authorization을 수행하세요.';
const migrationBoundaryRequirements = [
  [
    englishMigrationPath,
    '## GraphQL Migration Boundaries',
    [
      'NestJS resolver guards and `GqlExecutionContext` do not transfer to `@fluojs/graphql`.',
      '`GraphqlModule` mounts the GraphQL HTTP endpoint at the fixed `/graphql` path.',
      'All resolver decorators target public instance members:',
      'Root `outputType` is never inferred:',
      "Resolvers that inject request-scoped providers must themselves use `@Scope('request')`.",
      'the application must return a typed `AsyncIterable` and close application resources when GraphQL stops consuming it.',
    ],
  ],
  [
    koreanMigrationPath,
    '## GraphQL 마이그레이션 경계',
    [
      'NestJS resolver guard와 `GqlExecutionContext`는 `@fluojs/graphql`로 이전되지 않습니다.',
      '`GraphqlModule`은 GraphQL HTTP endpoint를 고정된 `/graphql` path에 mount합니다.',
      '모든 resolver decorator는 public instance member를 대상으로 합니다.',
      'Root `outputType`은 추론되지 않습니다.',
      "Request-scoped provider를 주입하는 resolver에는 반드시 `@Scope('request')`를 붙여야 합니다.",
      'Application은 typed `AsyncIterable`을 반환하고 GraphQL이 소비를 멈출 때 application resource를 닫아야 합니다.',
    ],
  ],
] as const;

const discoverabilityRequirements = [
  [
    'docs/CONTEXT.md',
    '[GraphQL Migration Boundaries](./getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  ],
  [
    'docs/CONTEXT.ko.md',
    '[GraphQL 마이그레이션 경계](./getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  ],
  [
    'packages/graphql/README.md',
    '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  ],
  [
    'packages/graphql/README.ko.md',
    '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  ],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('GraphQL NestJS migration boundaries', () => {
  it('keeps the canonical migration-boundary contract enforced', () => {
    expect(() => enforceGraphqlNestjsMigrationBoundaries()).not.toThrow();
  });

  it.each(migrationBoundaryRequirements)(
    'rejects a missing canonical claim in %s',
    (driftedPath, _heading, requirements) => {
      for (const requirement of requirements) {
        const readWithoutClaim = (relativePath: string): string =>
          relativePath === driftedPath
            ? read(relativePath).replace(requirement, '[removed GraphQL migration claim]')
            : read(relativePath);

        expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutClaim)).toThrow(driftedPath);
      }
    },
  );

  it.each(discoverabilityRequirements)(
    'rejects a missing canonical migration link in %s',
    (driftedPath, link) => {
      const readWithoutLink = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(link, '[removed GraphQL migration link]')
          : read(relativePath);

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutLink)).toThrow(driftedPath);
    },
  );

  it('rejects a canonical claim hidden in an HTML comment', () => {
    // Given: the fixed endpoint claim exists only in non-rendered comment content.
    const claim = migrationBoundaryRequirements[0][2][1];
    const readWithCommentOnlyClaim = (relativePath: string): string =>
      relativePath === englishMigrationPath
        ? read(relativePath).replace(claim, `<!-- ${claim} -->`)
        : read(relativePath);

    // When/Then: governance evaluates rendered prose and rejects the hidden claim.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithCommentOnlyClaim)).toThrow(englishMigrationPath);
  });

  it('rejects a canonical claim hidden in a fenced example', () => {
    // Given: the fixed endpoint claim exists only inside a fenced Markdown example.
    const claim = migrationBoundaryRequirements[0][2][1];
    const readWithFencedOnlyClaim = (relativePath: string): string =>
      relativePath === englishMigrationPath
        ? read(relativePath).replace(claim, `\`\`\`text\n${claim}\n\`\`\``)
        : read(relativePath);

    // When/Then: governance ignores the example and rejects the missing rendered claim.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithFencedOnlyClaim)).toThrow(englishMigrationPath);
  });

  it.each([
    ['an inline code span', (link: string) => `\`${link}\``],
    ['an indented code block', (link: string) => `\n    ${link}\n`],
  ])('rejects a canonical migration link hidden in %s', (_description, hideLink) => {
    // Given: the canonical link exists only in Markdown code rather than rendered prose.
    const [driftedPath, link] = discoverabilityRequirements[0];
    const readWithCodeOnlyLink = (relativePath: string): string =>
      relativePath === driftedPath ? read(relativePath).replace(link, hideLink(link)) : read(relativePath);

    // When/Then: code-rendered text cannot satisfy the discoverability contract.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithCodeOnlyLink)).toThrow(driftedPath);
  });

  it('rejects a negated canonical claim', () => {
    // Given: the document contains the canonical words only as a negated statement.
    const claim = migrationBoundaryRequirements[0][2][0];
    const readWithNegatedClaim = (relativePath: string): string =>
      relativePath === englishMigrationPath
        ? read(relativePath).replace(claim, `It is not true that ${claim}`)
        : read(relativePath);

    // When/Then: raw substring presence cannot satisfy the affirmative contract.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithNegatedClaim)).toThrow(englishMigrationPath);
  });

  it.each([
    [englishMigrationPath, englishAuthenticationClaim, 'The following statement is false:'],
    [koreanMigrationPath, koreanAuthenticationClaim, '다음 주장은 사실이 아닙니다:'],
  ])('rejects a prefix-negated authentication claim in %s', (driftedPath, claim, negation) => {
    // Given: a prefix explicitly negates the canonical authentication sentence that follows.
    const readWithPrefixNegation = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(claim, `${negation} ${claim}`)
        : read(relativePath);

    // When/Then: a sentence-boundary prefix cannot turn negated prose into an affirmative claim.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithPrefixNegation)).toThrow(driftedPath);
  });

  it('rejects two canonical links on one line', () => {
    // Given: one discoverability line repeats the complete canonical link twice.
    const [driftedPath, link] = discoverabilityRequirements[0];
    const readWithDuplicateLink = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(link, `${link} ${link}`)
        : read(relativePath);

    // When/Then: governance counts literal link occurrences, not matching lines.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithDuplicateLink)).toThrow(driftedPath);
  });

  it.each([
    [
      englishMigrationPath,
      englishAuthenticationClaim,
      'Authenticate GraphQL HTTP requests in application-owned middleware or guards.',
    ],
    [
      koreanMigrationPath,
      koreanAuthenticationClaim,
      'GraphQL HTTP request는 application-owned middleware 또는 guard에서 인증합니다.',
    ],
    [
      englishBookPath,
      englishAuthenticationClaim,
      'Authenticate HTTP requests in application-owned middleware or guards.',
    ],
    [
      koreanBookPath,
      koreanAuthenticationClaim,
      'HTTP request는 application-owned middleware 또는 guard에서 인증합니다.',
    ],
  ])('rejects obsolete GraphQL HTTP route-guard guidance in %s', (driftedPath, claim, obsoleteGuidance) => {
    // Given: rendered migration prose recommends a route guard that cannot run.
    const readWithObsoleteGuidance = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(claim, `${claim}\n\n${obsoleteGuidance}`)
        : read(relativePath);

    // When/Then: governance rejects the contradictory rendered guidance.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithObsoleteGuidance)).toThrow(driftedPath);
  });

  it.each([
    [englishMigrationPath, englishAuthenticationClaim, 'GraphQL HTTP route guards do run after GraphqlModule.'],
    [englishBookPath, englishAuthenticationClaim, 'This statement is false.'],
    [koreanMigrationPath, koreanAuthenticationClaim, '이 설명은 사실이 아닙니다.'],
    [koreanBookPath, koreanAuthenticationClaim, '`GraphqlModule` 뒤의 GraphQL HTTP route guard도 실행됩니다.'],
  ])('rejects adversarial authentication contradictions in %s', (driftedPath, claim, contradiction) => {
    // Given: the governed claim remains present while nearby prose reverses its meaning.
    const readWithContradiction = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(claim, `${claim}\n\n${contradiction}`)
        : read(relativePath);

    // When/Then: contradictory rendered governance is rejected independently of exact paragraph wording.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithContradiction)).toThrow(driftedPath);
  });

  it.each([
    [englishReadmePath, 'GraphQL HTTP route guards may establish the authenticated principal.'],
    [koreanReadmePath, 'GraphQL HTTP route guard가 인증된 principal을 설정할 수 있습니다.'],
  ])('rejects stale principal guidance across the governed package surface in %s', (driftedPath, staleClaim) => {
    // Given: a governed package README reintroduces an impossible principal source.
    const readWithStaleClaim = (relativePath: string): string =>
      relativePath === driftedPath ? `${read(relativePath)}\n${staleClaim}\n` : read(relativePath);

    // When/Then: every governed GraphQL documentation surface rejects the stale claim.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithStaleClaim)).toThrow(driftedPath);
  });

  it.each([
    [englishMigrationPath, englishAuthenticationClaim],
    [koreanMigrationPath, koreanAuthenticationClaim],
    [englishBookPath, englishAuthenticationClaim],
    [koreanBookPath, koreanAuthenticationClaim],
  ])('requires the rendered principal-establishment claim in %s', (driftedPath, claim) => {
    // Given: the final required authentication claim is absent from rendered prose.
    const readWithoutAuthenticationClaim = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(claim, '[removed GraphQL authentication boundary]')
        : read(relativePath);

    // When/Then: governance rejects the missing runtime-accurate claim.
    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutAuthenticationClaim)).toThrow(driftedPath);
  });
});
