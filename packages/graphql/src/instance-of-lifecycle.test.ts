import { createRequire } from 'node:module';

import { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import { describe, expect, it } from 'vitest';

import { type GraphqlInstanceOf, type GraphqlInstanceOfModule, installGraphqlInstanceOfPatch } from './instance-of-patch.js';
import { GraphqlLifecycleService } from './service.js';

const runtimeRequire = createRequire(import.meta.url);

class GraphQLSchemaConstructor {}

Object.defineProperty(GraphQLSchemaConstructor.prototype, Symbol.toStringTag, {
  value: 'GraphQLSchema',
});

function createCrossRealmSchema(name: string): GraphQLSchema {
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      fields: {
        value: {
          resolve: () => name,
          type: GraphQLString,
        },
      },
      name: `${name}Query`,
    }),
  });
  const crossRealmPrototype = Object.create(
    null,
    Object.getOwnPropertyDescriptors(GraphQLSchema.prototype),
  );

  return Object.create(crossRealmPrototype, Object.getOwnPropertyDescriptors(schema));
}

function createService(schema: GraphQLSchema, websocketEnabled = false): GraphqlLifecycleService {
  const adapter: HttpApplicationAdapter = {
    async close() {},
    async listen() {},
  };
  const compiledModules: CompiledModule[] = [];
  const logger: ApplicationLogger = {
    debug() {},
    error() {},
    log() {},
    warn() {},
  };

  return new GraphqlLifecycleService(new Container(), compiledModules, logger, adapter, {
    schema,
    ...(websocketEnabled ? { subscriptions: { websocket: { enabled: true } } } : {}),
  });
}

describe('GraphqlLifecycleService cross-instance object isolation', () => {
  it('releases a module patch without affecting a different GraphQL module instance', () => {
    // Given
    const originalInstanceOf: GraphqlInstanceOf = () => false;
    const firstModule: GraphqlInstanceOfModule = { instanceOf: originalInstanceOf };
    const secondModule: GraphqlInstanceOfModule = { instanceOf: originalInstanceOf };
    const firstCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const secondCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const releaseFirstPatch = installGraphqlInstanceOfPatch(
      firstModule,
      new WeakSet<object>([firstCrossRealmSchema]),
    );
    const releaseSecondPatch = installGraphqlInstanceOfPatch(
      secondModule,
      new WeakSet<object>([secondCrossRealmSchema]),
    );

    // When
    releaseFirstPatch();

    // Then
    expect(firstModule.instanceOf(firstCrossRealmSchema, GraphQLSchemaConstructor)).toBe(false);
    expect(secondModule.instanceOf(secondCrossRealmSchema, GraphQLSchemaConstructor)).toBe(true);

    releaseSecondPatch();
  });

  it('preserves an externally replaced instanceOf implementation during release', () => {
    // Given
    const originalInstanceOf: GraphqlInstanceOf = () => false;
    const instanceOfModule: GraphqlInstanceOfModule = { instanceOf: originalInstanceOf };
    const allowedCrossRealmSchema = { [Symbol.toStringTag]: 'GraphQLSchema' };
    const releasePatch = installGraphqlInstanceOfPatch(
      instanceOfModule,
      new WeakSet<object>([allowedCrossRealmSchema]),
    );
    const externalReplacement: GraphqlInstanceOf = () => true;

    // When
    instanceOfModule.instanceOf = externalReplacement;
    releasePatch();

    // Then
    expect(instanceOfModule.instanceOf).toBe(externalReplacement);
  });

  it("releases one application's cross-realm objects while another keeps the instanceOf patch active", async () => {
    // Given
    const instanceOfModule: { instanceOf: GraphqlInstanceOf } = runtimeRequire('graphql/jsutils/instanceOf.js');
    const releasedSchema = createCrossRealmSchema('Released');
    const activeSchema = createCrossRealmSchema('Active');
    const releasedService = createService(releasedSchema);
    const activeService = createService(activeSchema);

    try {
      await releasedService.onApplicationBootstrap();
      await activeService.onApplicationBootstrap();
      expect(instanceOfModule.instanceOf(releasedSchema, GraphQLSchema)).toBe(true);
      expect(instanceOfModule.instanceOf(activeSchema, GraphQLSchema)).toBe(true);

      // When
      await releasedService.onApplicationShutdown();

      // Then
      expect(() => instanceOfModule.instanceOf(releasedSchema, GraphQLSchema)).toThrow();
      expect(instanceOfModule.instanceOf(activeSchema, GraphQLSchema)).toBe(true);
    } finally {
      await releasedService.onApplicationShutdown();
      await activeService.onApplicationShutdown();
    }
  });

  it("releases a failed application's cross-realm objects while another keeps the instanceOf patch active", async () => {
    // Given
    const instanceOfModule: { instanceOf: GraphqlInstanceOf } = runtimeRequire('graphql/jsutils/instanceOf.js');
    const failedSchema = createCrossRealmSchema('Failed');
    const activeSchema = createCrossRealmSchema('ActiveAfterFailure');
    const failedService = createService(failedSchema, true);
    const activeService = createService(activeSchema);

    try {
      await activeService.onApplicationBootstrap();

      // When
      await expect(failedService.onApplicationBootstrap()).rejects.toThrow(
        'GraphQL websocket subscriptions require an HTTP adapter with getServer().',
      );

      // Then
      expect(() => instanceOfModule.instanceOf(failedSchema, GraphQLSchema)).toThrow();
      expect(instanceOfModule.instanceOf(activeSchema, GraphQLSchema)).toBe(true);
    } finally {
      await failedService.onApplicationShutdown();
      await activeService.onApplicationShutdown();
    }
  });
});
