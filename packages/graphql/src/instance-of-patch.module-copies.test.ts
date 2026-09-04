import { expect, it } from 'vitest';

import type { GraphqlInstanceOf, GraphqlInstanceOfModule } from './instance-of-patch.js';

class GraphQLSchemaConstructor {}

Object.defineProperty(GraphQLSchemaConstructor.prototype, Symbol.toStringTag, {
  value: 'GraphQLSchema',
});

const patchManagerModuleUrl = new URL('./instance-of-patch.ts', import.meta.url);

it.each([
  ['first', 'second'],
  ['second', 'first'],
] as const)(
  'shares an owner patch state when copied managers release in %s then %s order',
  async (firstRelease, secondRelease) => {
    // Given
    const firstManager = await import(`${patchManagerModuleUrl.href}?module-copy=first`);
    const secondManager = await import(`${patchManagerModuleUrl.href}?module-copy=second`);
    const originalInstanceOf: GraphqlInstanceOf = () => false;
    const instanceOfModule: GraphqlInstanceOfModule = { instanceOf: originalInstanceOf };
    const firstCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const secondCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const releaseFirstPatch = firstManager.installGraphqlInstanceOfPatch(
      instanceOfModule,
      new WeakSet<object>([firstCrossRealmSchema]),
    );
    const releaseSecondPatch = secondManager.installGraphqlInstanceOfPatch(
      instanceOfModule,
      new WeakSet<object>([secondCrossRealmSchema]),
    );
    const releases = {
      first: releaseFirstPatch,
      second: releaseSecondPatch,
    };

    // When
    releases[firstRelease]();

    // Then
    const activeCrossRealmSchema =
      firstRelease === 'first' ? secondCrossRealmSchema : firstCrossRealmSchema;
    expect(instanceOfModule.instanceOf(activeCrossRealmSchema, GraphQLSchemaConstructor)).toBe(true);

    releases[secondRelease]();
    expect(instanceOfModule.instanceOf).toBe(originalInstanceOf);
  },
);

it.each([
  ['first', 'second'],
  ['second', 'first'],
] as const)(
  'restores an external wrapper after copied managers release in %s then %s order',
  async (firstRelease, secondRelease) => {
    // Given
    const firstManager = await import(`${patchManagerModuleUrl.href}?external-wrapper-copy=first`);
    const secondManager = await import(`${patchManagerModuleUrl.href}?external-wrapper-copy=second`);
    const originalInstanceOf: GraphqlInstanceOf = () => false;
    const instanceOfModule: GraphqlInstanceOfModule = { instanceOf: originalInstanceOf };
    const firstCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const secondCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const releaseFirstPatch = firstManager.installGraphqlInstanceOfPatch(
      instanceOfModule,
      new WeakSet<object>([firstCrossRealmSchema]),
    );
    const capturedPatch = instanceOfModule.instanceOf;
    const externalWrapper: GraphqlInstanceOf = (value, constructor) => capturedPatch(value, constructor);

    instanceOfModule.instanceOf = externalWrapper;
    const releaseSecondPatch = secondManager.installGraphqlInstanceOfPatch(
      instanceOfModule,
      new WeakSet<object>([secondCrossRealmSchema]),
    );
    const releases = {
      first: releaseFirstPatch,
      second: releaseSecondPatch,
    };

    // When
    releases[firstRelease]();

    // Then
    const activeCrossRealmSchema =
      firstRelease === 'first' ? secondCrossRealmSchema : firstCrossRealmSchema;
    expect(instanceOfModule.instanceOf(activeCrossRealmSchema, GraphQLSchemaConstructor)).toBe(true);

    releases[secondRelease]();
    expect(instanceOfModule.instanceOf).toBe(externalWrapper);
  },
);
