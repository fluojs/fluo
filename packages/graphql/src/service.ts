import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';

import { Controller, Get, Post, type FrameworkRequest, type FrameworkResponse, type Middleware, type MiddlewareContext, type Next } from '@konekti/http';
import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@konekti/runtime';
import type {
  GraphQLFieldConfigMap,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLString as GraphQLStringType,
} from 'graphql';

import { getArgFieldMetadataEntries, getResolverHandlerMetadataEntries, getResolverMetadata } from './metadata.js';
import { GRAPHQL_LIFECYCLE_SERVICE, GRAPHQL_MODULE_OPTIONS } from './tokens.js';
import type {
  GraphQLContext,
  GraphqlModuleOptions,
  GraphqlRequestContext,
  ResolverDescriptor,
  ResolverHandlerDescriptor,
  ResolverHandlerType,
} from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface NodeWritableResponse {
  end(chunk?: unknown): void;
  flushHeaders?: () => void;
  once(event: 'drain', listener: () => void): this;
  writableEnded?: boolean;
  write(chunk: unknown): boolean;
}

type YogaLike = {
  fetch(request: Request): Promise<Response>;
};

type GraphqlInstanceOf = (value: unknown, constructor: { prototype?: { [Symbol.toStringTag]?: string } }) => boolean;

interface GraphqlDeps {
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: typeof GraphQLStringType;
  buildSchema: (source: string) => GraphQLSchemaType;
  createYoga: (options: Record<string, unknown>) => YogaLike;
}

const graphqlRequestContextStorage = new AsyncLocalStorage<GraphqlRequestContext>();
const runtimeRequire = createRequire(import.meta.url);
let graphqlInstanceOfPatched = false;
const allowedCrossRealmGraphqlObjects = new WeakSet<object>();

@Controller('/graphql')
export class GraphqlEndpointController {
  @Get('/')
  handleGet(): undefined {
    return undefined;
  }

  @Post('/')
  handlePost(): undefined {
    return undefined;
  }
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function isGraphqlPath(path: string): boolean {
  return path === '/graphql' || path === '/graphql/';
}

function resolveAbsoluteRequestUrl(request: FrameworkRequest): string {
  const hostHeader = request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const protoHeader = request.headers['x-forwarded-proto'];
  const protoValue = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const proto = typeof protoValue === 'string' && protoValue.length > 0 ? protoValue : 'http';
  const base = `${proto}://${host ?? 'localhost'}`;

  return new URL(request.url || request.path || '/graphql', base).toString();
}

function createFetchHeaders(request: FrameworkRequest): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(name, value);
    }
  }

  return headers;
}

function createFetchBody(request: FrameworkRequest, headers: Headers): BodyInit | undefined {
  const method = request.method.toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  if (request.rawBody) {
    return Buffer.from(request.rawBody);
  }

  if (request.body === undefined) {
    return undefined;
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  if (request.body instanceof Uint8Array) {
    return Buffer.from(request.body);
  }

  if (request.body instanceof ArrayBuffer) {
    return Buffer.from(request.body);
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }

  return JSON.stringify(request.body);
}

function toFetchRequest(request: FrameworkRequest): Request {
  const headers = createFetchHeaders(request);
  const body = createFetchBody(request, headers);

  return new Request(resolveAbsoluteRequestUrl(request), {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  });
}

function isNodeWritableResponse(raw: unknown): raw is NodeWritableResponse {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }

  const candidate = raw as {
    end?: unknown;
    once?: unknown;
    write?: unknown;
  };

  return typeof candidate.write === 'function' && typeof candidate.end === 'function' && typeof candidate.once === 'function';
}

function createGraphqlInput(
  inputClass: Function | undefined,
  args: Record<string, unknown>,
  argFieldDescriptors: ResolverHandlerDescriptor['argFields'],
): unknown {
  if (!inputClass) {
    return Object.keys(args).length === 0 ? undefined : args;
  }

  const instance = Object.create(inputClass.prototype) as Record<string, unknown>;

  if (argFieldDescriptors.length === 0) {
    Object.assign(instance, args);
    return instance;
  }

  for (const descriptor of argFieldDescriptors) {
    instance[descriptor.fieldName] = args[descriptor.argName];
  }

  return instance;
}

function normalizeAllowedResolverSet(resolvers: Function[] | undefined): Set<Function> | undefined {
  if (!resolvers || resolvers.length === 0) {
    return undefined;
  }

  return new Set(resolvers);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

function isGraphQLSchemaLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return (
    typeof (value as Record<string, unknown>).getQueryType === 'function' &&
    typeof (value as Record<string, unknown>).getTypeMap === 'function'
  );
}

function getCrossRealmGraphqlTag(value: unknown, constructor: { prototype?: { [Symbol.toStringTag]?: string } }): string | undefined {
  const className = constructor.prototype?.[Symbol.toStringTag];

  if (typeof className !== 'string' || !className.startsWith('GraphQL')) {
    return undefined;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (Symbol.toStringTag in value) {
    const valueClassName = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];

    return valueClassName === className ? className : undefined;
  }

  const valueClassName = (value as { constructor?: { name?: string } }).constructor?.name;

  return valueClassName === className ? className : undefined;
}

function markAllowedCrossRealmGraphqlObjects(value: unknown, visited = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  if (visited.has(value)) {
    return;
  }

  visited.add(value);

  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];

  if (typeof tag === 'string' && tag.startsWith('GraphQL')) {
    allowedCrossRealmGraphqlObjects.add(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      markAllowedCrossRealmGraphqlObjects(item, visited);
    }

    return;
  }

  for (const nestedValue of Object.values(value)) {
    markAllowedCrossRealmGraphqlObjects(nestedValue, visited);
  }
}

function isAllowedCrossRealmGraphqlObject(
  value: unknown,
  constructor: { prototype?: { [Symbol.toStringTag]?: string } },
): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return allowedCrossRealmGraphqlObjects.has(value) && getCrossRealmGraphqlTag(value, constructor) !== undefined;
}

function patchGraphqlInstanceOf(): void {
  if (graphqlInstanceOfPatched) {
    return;
  }

  const instanceOfModule = runtimeRequire('graphql/jsutils/instanceOf.js') as {
    instanceOf: GraphqlInstanceOf;
  };
  const originalInstanceOf = instanceOfModule.instanceOf;

  instanceOfModule.instanceOf = (value, constructor) => {
    try {
      if (originalInstanceOf(value, constructor)) {
        return true;
      }
    } catch (error) {
      if (isAllowedCrossRealmGraphqlObject(value, constructor)) {
        return true;
      }

      throw error;
    }

    return isAllowedCrossRealmGraphqlObject(value, constructor);
  };

  graphqlInstanceOfPatched = true;
}

function pickFieldsByType(
  descriptors: ResolverDescriptor[],
  handlerType: ResolverHandlerType,
  invokeResolver: (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ) => Promise<unknown>,
  GraphQLString: typeof GraphQLStringType,
): GraphQLFieldConfigMap<unknown, GraphQLContext> {
  const fields: GraphQLFieldConfigMap<unknown, GraphQLContext> = {};

  for (const descriptor of descriptors) {
    for (const handler of descriptor.handlers) {
      if (handler.type !== handlerType) {
        continue;
      }

      const args = Object.fromEntries(
        handler.argFields.map((argField) => [
          argField.argName,
          {
            type: GraphQLString,
          },
        ]),
      );

      if (handler.type === 'subscription') {
        fields[handler.fieldName] = {
          args,
          resolve(payload: unknown): unknown {
            return payload;
          },
          subscribe: async (
            _source: unknown,
            rawArgs: Record<string, unknown>,
            contextValue: GraphQLContext,
          ): Promise<AsyncIterable<unknown>> => {
            const value = await invokeResolver(descriptor, handler, rawArgs, contextValue);

            if (!isAsyncIterable(value)) {
              throw new Error(
                `Subscription resolver ${descriptor.targetName}.${handler.methodName} must return AsyncIterable.`,
              );
            }

            return value;
          },
          type: GraphQLString,
        };

        continue;
      }

      fields[handler.fieldName] = {
        args,
        resolve: async (
          _source: unknown,
          rawArgs: Record<string, unknown>,
          contextValue: GraphQLContext,
        ): Promise<unknown> => {
          return invokeResolver(descriptor, handler, rawArgs, contextValue);
        },
        type: GraphQLString,
      };
    }
  }

  return fields;
}

async function loadGraphqlDeps(): Promise<GraphqlDeps> {
  patchGraphqlInstanceOf();

  const graphqlMod = runtimeRequire('graphql') as typeof import('graphql');
  const yogaMod = runtimeRequire('graphql-yoga') as typeof import('graphql-yoga');

  return {
    GraphQLObjectType: graphqlMod.GraphQLObjectType,
    GraphQLSchema: graphqlMod.GraphQLSchema,
    GraphQLString: graphqlMod.GraphQLString,
    buildSchema: graphqlMod.buildSchema,
    createYoga: yogaMod.createYoga as (options: Record<string, unknown>) => YogaLike,
  };
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, GRAPHQL_MODULE_OPTIONS])
export class GraphqlLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private middlewareRegistered = false;
  private yoga: YogaLike | undefined;

  private readonly middleware: Middleware = {
    handle: async (context: MiddlewareContext, next: Next) => {
      if (!isGraphqlPath(context.request.path)) {
        await next();
        return;
      }

      const yoga = this.yoga;

      if (!yoga) {
        this.logger.error('GraphQL middleware was invoked before GraphQL Yoga initialization.', undefined, 'GraphqlLifecycleService');
        context.response.setStatus(500);
        await context.response.send({
          errors: [{ message: 'GraphQL server not initialized.' }],
        });
        return;
      }

      try {
        const fetchRequest = toFetchRequest(context.request);
        const fetchResponse = await graphqlRequestContextStorage.run({
          principal: context.requestContext.principal,
          request: context.request,
        }, () => {
          return yoga.fetch(fetchRequest);
        });

        await this.writeFetchResponse(fetchResponse, context.response);
      } catch (error) {
        this.logger.error('Failed to process GraphQL request.', error, 'GraphqlLifecycleService');

        if (!context.response.committed) {
          context.response.setStatus(500);
          await context.response.send({
            errors: [{ message: 'Internal server error.' }],
          });
        }
      }
    },
  };

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly options: GraphqlModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.middlewareRegistered) {
      return;
    }

    const deps = await loadGraphqlDeps();
    const schema = this.resolveSchema(deps);

    this.yoga = deps.createYoga({
      context: ({ request }: { request: Request }) => {
        return this.buildGraphqlContext(request);
      },
      graphqlEndpoint: '/graphql',
      graphiql: this.resolveGraphiqlEnabled(),
      schema,
    });

    this.registerMiddleware();
    this.middlewareRegistered = true;
  }

  async onApplicationShutdown(): Promise<void> {
    this.middlewareRegistered = false;
    this.yoga = undefined;
  }

  private resolveGraphiqlEnabled(): boolean {
    if (this.options.graphiql !== undefined) {
      return this.options.graphiql;
    }

    return process.env.NODE_ENV !== 'production';
  }

  private resolveSchema(deps: GraphqlDeps): GraphQLSchemaType {
    if (isGraphQLSchemaLike(this.options.schema)) {
      markAllowedCrossRealmGraphqlObjects(this.options.schema);

      return this.options.schema as GraphQLSchemaType;
    }

    if (typeof this.options.schema === 'string') {
      return deps.buildSchema(this.options.schema);
    }

    return this.createCodeFirstSchema(deps);
  }

  private createCodeFirstSchema(deps: GraphqlDeps): GraphQLSchemaType {
    const { GraphQLObjectType, GraphQLSchema, GraphQLString } = deps;
    const resolverDescriptors = this.discoverResolverDescriptors();

    if (resolverDescriptors.length === 0) {
      throw new Error('GraphQL module requires either schema or at least one resolver decorated with @Resolver().');
    }

    const invokeResolver = async (
      descriptor: ResolverDescriptor,
      handler: ResolverHandlerDescriptor,
      args: Record<string, unknown>,
      contextValue: GraphQLContext,
    ): Promise<unknown> => {
      const instance = await this.runtimeContainer.resolve(descriptor.token);
      const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

      if (typeof value !== 'function') {
        throw new Error(`Resolver handler ${descriptor.targetName}.${handler.methodName} is not callable.`);
      }

      const input = createGraphqlInput(handler.inputClass, args, handler.argFields);

      return value.call(instance, input, contextValue);
    };

    const queryFields = pickFieldsByType(resolverDescriptors, 'query', invokeResolver, GraphQLString);
    const mutationFields = pickFieldsByType(resolverDescriptors, 'mutation', invokeResolver, GraphQLString);
    const subscriptionFields = pickFieldsByType(resolverDescriptors, 'subscription', invokeResolver, GraphQLString);

    const queryType = new GraphQLObjectType({
      fields:
        Object.keys(queryFields).length === 0
          ? {
              _empty: {
                resolve: () => 'ok',
                type: GraphQLString,
              },
            }
          : queryFields,
      name: 'Query',
    });

    const mutationType =
      Object.keys(mutationFields).length === 0
        ? undefined
        : new GraphQLObjectType({
            fields: mutationFields,
            name: 'Mutation',
          });

    const subscriptionType =
      Object.keys(subscriptionFields).length === 0
        ? undefined
        : new GraphQLObjectType({
            fields: subscriptionFields,
            name: 'Subscription',
          });

    return new GraphQLSchema({
      mutation: mutationType,
      query: queryType,
      subscription: subscriptionType,
    });
  }

  private discoverResolverDescriptors(): ResolverDescriptor[] {
    const allowedResolvers = normalizeAllowedResolverSet(this.options.resolvers);
    const seenTargets = new Set<Function>();
    const descriptors: ResolverDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      if (allowedResolvers && !allowedResolvers.has(candidate.targetType)) {
        continue;
      }

      const resolverMetadata = getResolverMetadata(candidate.targetType);

      if (!resolverMetadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @Resolver() but is registered with ${candidate.scope} scope. GraphQL resolvers are registered only for singleton providers.`,
          'GraphqlLifecycleService',
        );
        continue;
      }

      if (seenTargets.has(candidate.targetType)) {
        continue;
      }

      seenTargets.add(candidate.targetType);
      descriptors.push({
        handlers: getResolverHandlerMetadataEntries(candidate.targetType.prototype).map((entry) => {
          const inputClass = entry.metadata.inputClass;
          const argFields =
            inputClass !== undefined
              ? getArgFieldMetadataEntries(inputClass.prototype).map((argField) => argField.metadata)
              : [];

          return {
            argFields,
            fieldName: entry.metadata.fieldName ?? methodKeyToName(entry.propertyKey),
            inputClass,
            methodKey: entry.propertyKey,
            methodName: methodKeyToName(entry.propertyKey),
            topics: entry.metadata.topics,
            type: entry.metadata.type,
          };
        }),
        moduleName: candidate.moduleName,
        targetName: candidate.targetType.name,
        token: candidate.token,
        typeName: resolverMetadata.typeName,
      });
    }

    return descriptors;
  }

  private discoveryCandidates(): DiscoveryCandidate[] {
    const candidates: DiscoveryCandidate[] = [];

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        if (typeof provider === 'function') {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider,
            token: provider,
          });
          continue;
        }

        if (isClassProvider(provider)) {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider.useClass,
            token: provider.provide,
          });
        }
      }

      for (const controller of compiledModule.definition.controllers ?? []) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(controller),
          targetType: controller,
          token: controller,
        });
      }
    }

    return candidates;
  }

  private registerMiddleware(): void {
    for (const compiledModule of this.compiledModules) {
      if (!compiledModule.providerTokens.has(GRAPHQL_LIFECYCLE_SERVICE)) {
        continue;
      }

      const middleware = compiledModule.definition.middleware ?? [];

      if (!middleware.includes(this.middleware)) {
        middleware.push(this.middleware);
      }

      compiledModule.definition.middleware = middleware;
    }
  }

  private buildGraphqlContext(request: Request): GraphQLContext {
    const fallbackRequest: FrameworkRequest = {
      cookies: {},
      headers: {},
      method: request.method,
      params: {},
      path: new URL(request.url).pathname,
      query: Object.fromEntries(new URL(request.url).searchParams.entries()),
      raw: request,
      url: new URL(request.url).pathname + new URL(request.url).search,
    };

    const storedContext = graphqlRequestContextStorage.getStore();
    const requestContext: GraphqlRequestContext = {
      principal: storedContext?.principal,
      request: storedContext?.request ?? fallbackRequest,
    };
    const customContext = this.options.context?.(requestContext) ?? {};

    return {
      ...customContext,
      principal: requestContext.principal,
      request: requestContext.request,
    };
  }

  private async writeFetchResponse(fetchResponse: Response, frameworkResponse: FrameworkResponse): Promise<void> {
    frameworkResponse.setStatus(fetchResponse.status);

    for (const [name, value] of fetchResponse.headers.entries()) {
      frameworkResponse.setHeader(name, value);
    }

    const raw = frameworkResponse.raw;

    if (fetchResponse.body && isNodeWritableResponse(raw)) {
      frameworkResponse.committed = true;
      raw.flushHeaders?.();

      const reader = fetchResponse.body.getReader();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (raw.writableEnded) {
          break;
        }

        const canContinue = raw.write(Buffer.from(value));

        if (!canContinue && !raw.writableEnded) {
          await new Promise<void>((resolve) => {
            raw.once('drain', () => resolve());
          });
        }
      }

      if (!raw.writableEnded) {
        raw.end();
      }

      return;
    }

    const buffer = await fetchResponse.arrayBuffer();

    await frameworkResponse.send(new Uint8Array(buffer));
  }
}
