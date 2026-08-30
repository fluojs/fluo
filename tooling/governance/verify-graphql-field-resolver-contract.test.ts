import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function graphqlMigrationSection(content: string): string {
  const heading = '## GraphQL Field Resolver DTO Arguments';
  const start = content.indexOf(heading);
  const end = content.indexOf('\n## ', start + heading.length);

  if (start === -1 || end === -1) {
    throw new Error('GraphQL resolver migration section is missing or unterminated.');
  }

  return content.slice(start, end);
}

const unsupportedMigrationClaims = [
  ['root-only', /\bsupports?\s+(?:only\s+root operations?|root operations?\s+only)\b/iu],
  ['root-only-ko', /root operations?만 지원/iu],
  ['full-nestjs-parity', /full NestJS (?:GraphQL )?resolver parity/iu],
  ['full-nestjs-parity-ko', /완전한 NestJS (?:GraphQL )?resolver parity/iu],
  ['parameter-decorator', /parameter-decorator syntax is supported/iu],
  ['parameter-decorator-ko', /parameter decorator 문법을 지원/iu],
  ['schema-first-field-resolver', /schema-first field-resolver attachment is supported/iu],
  ['schema-first-field-resolver-ko', /schema-first field-resolver attachment을 지원/iu],
  [
    'detached-type-reachability',
    /detached (?:object )?types? (?:are )?reachable without (?:a )?(?:code-first )?root (?:operation )?output/iu,
  ],
  ['detached-type-reachability-ko', /분리된 object type은 root operation output 없이도 도달 가능/iu],
  ['field-argument-binding', /field argument DTO binding (?:is |remains )?(?:un|not )supported/iu],
  ['field-argument-binding-ko', /field argument DTO binding(?:을|은)? (?:지원하지 않|미지원)/iu],
  [
    'field-argument-compound-limitation',
    /There is no `forRootAsync\(\.\.\.\)`, field argument DTO binding, schema-first field-resolver attachment, or `@Subscription\(\{ topics \}\)` contract\./u,
  ],
  [
    'field-argument-compound-limitation-ko',
    /`forRootAsync\(\.\.\.\)`, field argument DTO binding, schema-first field-resolver attachment, `@Subscription\(\{ topics \}\)` 계약은 없다\./u,
  ],
] as const;

function collectUnsupportedMigrationClaims(content: string): string[] {
  return unsupportedMigrationClaims
    .filter(([, pattern]) => pattern.test(content))
    .map(([claimName]) => claimName);
}

describe('GraphQL object field resolver contract governance', () => {
  it('keeps field resolver discovery and standard method bindings explicit across bilingual surfaces', () => {
    const contractSurfaces = [
      'packages/graphql/README.md',
      'packages/graphql/README.ko.md',
      'packages/graphql/field-resolver-rfc.md',
      'packages/graphql/field-resolver-rfc.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'docs/getting-started/migrate-from-nestjs.md',
      'docs/getting-started/migrate-from-nestjs.ko.md',
      'book/intermediate/ch18-graphql.md',
      'book/intermediate/ch18-graphql.ko.md',
    ].map(read);

    for (const content of contractSurfaces) {
      expect(content).toContain('@FieldResolver');
      expect(content).toContain('@Parent');
      expect(content).toContain('@Context');
      expect(content).toContain('@Args');
      expect(content).toContain('@FieldResolver({ input');
    }

    const decorators = read('packages/graphql/src/decorators.ts');
    const regressionTest = read('packages/graphql/src/field-resolver.test.ts');

    expect(decorators).toContain('export function FieldResolver');
    expect(decorators).toContain('export function Parent');
    expect(decorators).toContain('export function Context');
    expect(decorators).toContain('export function Args(parameterIndex = 0)');
    expect(regressionTest).toContain('discovers and executes a field resolver with parent and context bindings');
  });

  it('anchors migration guidance to implemented registration, reachability, and binding seams', () => {
    // Given
    const decorators = read('packages/graphql/src/decorators.ts');
    const discovery = read('packages/graphql/src/discovery.ts');
    const objectFieldResolvers = read('packages/graphql/src/schema/object-field-resolvers.ts');
    const schema = read('packages/graphql/src/schema/schema.ts');
    const inputRegression = read('packages/graphql/src/field-resolver-input.test.ts');
    const bootstrapRegression = read('packages/graphql/src/field-resolver-input-bootstrap.test.ts');
    const contextDocs = [read('docs/CONTEXT.md'), read('docs/CONTEXT.ko.md')] as const;
    const migrationDocs = [
      read('docs/getting-started/migrate-from-nestjs.md'),
      read('docs/getting-started/migrate-from-nestjs.ko.md'),
    ] as const;
    const migrationSections = migrationDocs.map(graphqlMigrationSection);

    // When
    const fieldResolverOptions = decorators.slice(
      decorators.indexOf('export interface FieldResolverOptions'),
      decorators.indexOf('type ClassDecoratorLike'),
    );

    // Then
    expect(decorators).toContain('export function Resolver(typeName?: string)');
    expect(decorators).toContain('export function FieldResolver');
    expect(decorators).toContain('export function Parent(parameterIndex = 0)');
    expect(decorators).toContain('export function Context(parameterIndex = 1)');
    expect(fieldResolverOptions).toContain('fieldName?: string');
    expect(fieldResolverOptions).toContain('type?: GraphqlRootOutputType');
    expect(fieldResolverOptions).toContain('input?: Function');
    expect(fieldResolverOptions).toContain('argTypes?: Record<string, GraphqlArgType>');
    expect(discovery).toContain('for (const provider of compiledModule.definition.providers ?? [])');
    expect(discovery).toContain('for (const controller of compiledModule.definition.controllers ?? [])');
    expect(objectFieldResolvers).toContain('methodArguments[binding.index] = parent;');
    expect(objectFieldResolvers).toContain('methodArguments[binding.index] = contextValue;');
    expect(objectFieldResolvers).toContain('methodArguments[binding.index] = input;');
    expect(objectFieldResolvers).toContain('not reachable from a code-first root operation output type');
    expect(schema).toContain('const objectFieldResolvers = new ObjectFieldResolverRegistry(resolverDescriptors);');
    expect(schema).toContain('objectFieldResolvers.assertAllTargetsAttached();');
    expect(inputRegression).toContain('@Context(0)');
    expect(inputRegression).toContain('@Args(1)');
    expect(inputRegression).toContain('@Parent(2)');
    expect(bootstrapRegression).toContain('rejects @Args() on root operations during bootstrap');
    expect(bootstrapRegression).toContain('rejects field resolver input without @Args() during bootstrap');
    expect(bootstrapRegression).toContain('rejects @Args() without field resolver input during bootstrap');

    for (const migrationSection of migrationSections) {
      expect(migrationSection).toContain('@Parent()');
      expect(migrationSection).toContain('@Context()');
      expect(migrationSection).toContain('@Args(index?)');
      expect(migrationSection).toContain('@FieldResolver({ input: InputDto })');
      expect(migrationSection).toMatch(/input.*@Args|@Args.*input/iu);
      expect(migrationSection).toMatch(/schema-first field-resolver attachment/iu);
    }

    for (const migrationDoc of migrationDocs) {
      expect(collectUnsupportedMigrationClaims(migrationDoc)).toEqual([]);
    }

    for (const contextDoc of contextDocs) {
      expect(contextDoc).toContain("@Resolver('TypeName')");
      expect(contextDoc).toContain('@FieldResolver(...)');
      expect(contextDoc).toContain('@FieldResolver({ input: InputDto })');
      expect(contextDoc).toContain('@Args(index?)');
      expect(contextDoc).toContain('provider');
      expect(contextDoc).toContain('controller');
      expect(contextDoc).toMatch(/two categor|두 category/iu);
      expect(collectUnsupportedMigrationClaims(contextDoc)).toEqual([]);
    }
  });

  it.each([
    ['root-only', 'The current runtime supports root operations only.'],
    ['root-only-ko', '현재 runtime은 root operation만 지원합니다.'],
    ['full-nestjs-parity', 'Object field resolvers have full NestJS resolver parity.'],
    ['full-nestjs-parity-ko', 'Object field resolver는 완전한 NestJS resolver parity를 제공합니다.'],
    ['parameter-decorator', 'Parameter-decorator syntax is supported for @Parent().'],
    ['parameter-decorator-ko', '@Parent() parameter decorator 문법을 지원합니다.'],
    ['schema-first-field-resolver', 'Schema-first field-resolver attachment is supported.'],
    ['schema-first-field-resolver-ko', 'Schema-first field-resolver attachment을 지원합니다.'],
    ['detached-type-reachability', 'Detached object types are reachable without a root operation output.'],
    ['detached-type-reachability-ko', '분리된 object type은 root operation output 없이도 도달 가능합니다.'],
    ['field-argument-binding', 'Field argument DTO binding is unsupported.'],
    ['field-argument-binding-ko', 'Field argument DTO binding을 지원하지 않습니다.'],
    [
      'field-argument-compound-limitation',
      'There is no `forRootAsync(...)`, field argument DTO binding, schema-first field-resolver attachment, or `@Subscription({ topics })` contract.',
    ],
    [
      'field-argument-compound-limitation-ko',
      '`forRootAsync(...)`, field argument DTO binding, schema-first field-resolver attachment, `@Subscription({ topics })` 계약은 없다.',
    ],
  ] as const)('rejects the unsupported %s migration claim', (claimName, claim) => {
    // Given
    const migrationSection = `### GraphQL Resolver Migration\n\n${claim}`;

    // When
    const detectedClaims = collectUnsupportedMigrationClaims(migrationSection);

    // Then
    expect(detectedClaims).toContain(claimName);
  });
});
