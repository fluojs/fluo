import { Inject } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import { Controller, type FrameworkRequest, Get, type HttpApplicationAdapter, type Middleware, type MiddlewareContext, type Next, Post } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule, OnApplicationBootstrap, OnApplicationShutdown } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import type {
  DocumentNode,
  ExecutionArgs,
  execute as executeGraphql,
  GraphQLBoolean as GraphQLBooleanType,
  GraphQLError as GraphQLErrorType,
  GraphQLFloat as GraphQLFloatType,
  GraphQLID as GraphQLIDType,
  GraphQLInt as GraphQLIntType,
  GraphQLList as GraphQLListType,
  GraphQLNonNull as GraphQLNonNullType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLString as GraphQLStringType,
  GraphQLUnionType as GraphQLUnionTypeType,
  subscribe as subscribeGraphql,
} from 'graphql';

import { discoverResolverDescriptors } from './discovery.js';
import { createGraphqlValidationPlugin, resolveGraphqlRequestLimits } from './guardrails.js';
import { GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN } from './internal-tokens.js';
import type { GraphqlNodeWebSocketSubscribeRequest, GraphqlNodeWebSocketTransport } from './node/graphql-websocket-transport.js';
import { createCodeFirstSchema, resolveSchema } from './schema/schema.js';
import { isGraphqlPath, toFetchRequest, writeFetchResponse } from './transport/transport.js';
import type {
  GraphQLContext,
  GraphqlModuleOptions,
  GraphqlRequestContext,
  ResolverDescriptor,
} from './types.js';
import { GRAPHQL_OPERATION_CONTAINER } from './types.js';

const GRAPHQL_CONTEXT_OVERRIDE = Symbol('fluo.graphql.context.override');

type YogaLike = {
  fetch(request: Request): Promise<Response>;
  getEnveloped(initialContext: unknown): {
    contextFactory: () => Promise<unknown> | unknown;
    execute: (args: ExecutionArgs) => unknown;
    parse: (source: string) => DocumentNode;
    schema: GraphQLSchemaType;
    subscribe: (args: ExecutionArgs) => unknown;
    validate: (schema: GraphQLSchemaType, document: DocumentNode) => readonly GraphQLErrorType[];
  };
};

type GraphqlConstructor = Function & { prototype: { [Symbol.toStringTag]?: string } };
type GraphqlInstanceOf = (value: unknown, constructor: GraphqlConstructor) => boolean;
type GraphqlInstanceOfModule = {
  instanceOf: GraphqlInstanceOf;
};

interface GraphqlWebSocketLimits {
  maxConnections: number;
  maxOperationsPerConnection: number;
  maxPayloadBytes: number;
}

const DEFAULT_GRAPHQL_WEBSOCKET_LIMITS: GraphqlWebSocketLimits = {
  maxConnections: 100,
  maxOperationsPerConnection: 25,
  maxPayloadBytes: 64 * 1024,
};

function buildFrameworkRequestFromFetchRequest(request: Request): FrameworkRequest {
  const requestUrl = new URL(request.url);

  return {
    cookies: {},
    headers: Object.fromEntries(request.headers.entries()),
    method: request.method,
    params: {},
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    raw: request,
    signal: request.signal,
    url: requestUrl.pathname + requestUrl.search,
  };
}

interface GraphqlDeps {
  GraphQLError: typeof GraphQLErrorType;
  GraphQLBoolean: typeof GraphQLBooleanType;
  GraphQLFloat: typeof GraphQLFloatType;
  GraphQLID: typeof GraphQLIDType;
  GraphQLInt: typeof GraphQLIntType;
  GraphQLList: typeof GraphQLListType;
  GraphQLNonNull: typeof GraphQLNonNullType;
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: typeof GraphQLStringType;
  GraphQLUnionType: typeof GraphQLUnionTypeType;
  buildSchema: (source: string) => GraphQLSchemaType;
  createGraphQLError: (message: string, options: { extensions?: Record<string, unknown> }) => GraphQLErrorType;
  createYoga: (options: Record<string, unknown>) => YogaLike;
  execute: typeof executeGraphql;
  instanceOfModule: GraphqlInstanceOfModule;
  subscribe: typeof subscribeGraphql;
}

let graphqlInstanceOfPatchRefCount = 0;
let restoreGraphqlInstanceOfPatch: (() => void) | undefined;
const allowedCrossRealmGraphqlObjects = new WeakSet<object>();

/**
 * Declares the HTTP endpoints that receive GraphQL GET and POST requests.
 */
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

function getCrossRealmGraphqlTag(value: unknown, constructor: GraphqlConstructor): string | undefined {
  const prototypeTag = constructor.prototype?.[Symbol.toStringTag];
  const className = typeof prototypeTag === 'string' ? prototypeTag : constructor.name;

  if (typeof className !== 'string' || !className.startsWith('GraphQL')) {
    return undefined;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const valueTag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];

  if (typeof valueTag === 'string') {
    return valueTag === className ? className : undefined;
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
  const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;

  if (
    (typeof tag === 'string' && tag.startsWith('GraphQL')) ||
    (typeof constructorName === 'string' && constructorName.startsWith('GraphQL'))
  ) {
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
  constructor: GraphqlConstructor,
): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return allowedCrossRealmGraphqlObjects.has(value) && getCrossRealmGraphqlTag(value, constructor) !== undefined;
}

function installGraphqlInstanceOfPatch(instanceOfModule: GraphqlInstanceOfModule): () => void {
  if (restoreGraphqlInstanceOfPatch) {
    graphqlInstanceOfPatchRefCount += 1;
    return releaseGraphqlInstanceOfPatch;
  }

  const patchedFrom = instanceOfModule.instanceOf;

  const patchedInstanceOf: GraphqlInstanceOf = (value, constructor) => {
    try {
      if (patchedFrom(value, constructor)) {
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
  instanceOfModule.instanceOf = patchedInstanceOf;

  graphqlInstanceOfPatchRefCount = 1;
  restoreGraphqlInstanceOfPatch = () => {
    if (instanceOfModule.instanceOf !== patchedInstanceOf) {
      return;
    }

    instanceOfModule.instanceOf = patchedFrom;
  };

  return releaseGraphqlInstanceOfPatch;
}

function releaseGraphqlInstanceOfPatch(): void {
  if (graphqlInstanceOfPatchRefCount === 0) {
    return;
  }

  graphqlInstanceOfPatchRefCount -= 1;

  if (graphqlInstanceOfPatchRefCount > 0) {
    return;
  }

  restoreGraphqlInstanceOfPatch?.();
  restoreGraphqlInstanceOfPatch = undefined;
}

async function loadGraphqlDeps(): Promise<GraphqlDeps> {
  const graphqlSpecifier = 'graphql';
  const yogaSpecifier = 'graphql-yoga';
  const instanceOfSpecifier = 'graphql/jsutils/instanceOf.js';
  const [graphqlMod, yogaMod, instanceOfModule] = await Promise.all([
    import(/* @vite-ignore */ graphqlSpecifier) as Promise<typeof import('graphql')>,
    import(/* @vite-ignore */ yogaSpecifier) as Promise<typeof import('graphql-yoga')>,
    import(/* @vite-ignore */ instanceOfSpecifier) as Promise<GraphqlInstanceOfModule>,
  ]);

  return {
    GraphQLError: graphqlMod.GraphQLError,
    GraphQLBoolean: graphqlMod.GraphQLBoolean,
    GraphQLFloat: graphqlMod.GraphQLFloat,
    GraphQLID: graphqlMod.GraphQLID,
    GraphQLInt: graphqlMod.GraphQLInt,
    GraphQLList: graphqlMod.GraphQLList,
    GraphQLNonNull: graphqlMod.GraphQLNonNull,
    GraphQLObjectType: graphqlMod.GraphQLObjectType,
    GraphQLSchema: graphqlMod.GraphQLSchema,
    GraphQLString: graphqlMod.GraphQLString,
    GraphQLUnionType: graphqlMod.GraphQLUnionType,
    buildSchema: graphqlMod.buildSchema,
    createGraphQLError: yogaMod.createGraphQLError as (
      message: string,
      options: { extensions?: Record<string, unknown> },
    ) => GraphQLErrorType,
    createYoga: yogaMod.createYoga as (options: Record<string, unknown>) => YogaLike,
    execute: graphqlMod.execute,
    instanceOfModule,
    subscribe: graphqlMod.subscribe,
  };
}

/**
 * Boots the GraphQL runtime, middleware, and subscription transports for the active adapter.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN)
export class GraphqlLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private graphQLErrorConstructor: typeof GraphQLErrorType | undefined;
  private middlewareRegistered = false;
  private readonly operationContainers = new WeakMap<Request, Container>();
  private readonly requestContexts = new WeakMap<Request, GraphqlRequestContext>();
  private readonly websocketOperationContainers = new Map<object, Map<string, Container>>();
  private websocketTransport: GraphqlNodeWebSocketTransport | undefined;
  private executeGraphqlOperation: typeof executeGraphql | undefined;
  private releaseGraphqlInstanceOfPatch: (() => void) | undefined;
  private subscribeGraphqlOperation: typeof subscribeGraphql | undefined;
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
        this.requestContexts.set(fetchRequest, {
          principal: context.requestContext.principal,
          request: context.request,
        });
        try {
          const fetchResponse = await yoga.fetch(fetchRequest);

          await writeFetchResponse(fetchResponse, context.response);
        } finally {
          this.requestContexts.delete(fetchRequest);
          await this.disposeOperationContainer(fetchRequest);
        }
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
    private readonly adapter: HttpApplicationAdapter,
    private readonly options: GraphqlModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.middlewareRegistered) {
      return;
    }

    try {
      const deps = await loadGraphqlDeps();
      const schema = this.resolveSchema(deps);
      this.executeGraphqlOperation = deps.execute;
      this.graphQLErrorConstructor = deps.GraphQLError;
      this.subscribeGraphqlOperation = deps.subscribe;
      const requestLimits = resolveGraphqlRequestLimits(this.options.limits);
      const validationPlugin = createGraphqlValidationPlugin({
        introspection: this.resolveIntrospectionEnabled(),
        limits: requestLimits,
      });

      this.yoga = deps.createYoga({
        context: (contextValue: { request: Request; [GRAPHQL_CONTEXT_OVERRIDE]?: GraphQLContext }) =>
          contextValue[GRAPHQL_CONTEXT_OVERRIDE] ?? this.buildGraphqlContext(contextValue.request),
        graphqlEndpoint: '/graphql',
        graphiql: this.resolveGraphiqlEnabled(),
        ...((validationPlugin || (this.options.plugins && this.options.plugins.length > 0))
          ? {
              plugins: [
                ...(validationPlugin ? [validationPlugin] : []),
                ...(this.options.plugins ?? []),
              ],
            }
          : {}),
        schema,
      });

      await this.registerWebSocketTransport();

      this.registerMiddleware();
      this.middlewareRegistered = true;
    } catch (error) {
      try {
        await this.resetGraphqlRuntimeState();
      } catch (cleanupError) {
        this.logger.error('Failed to clean up GraphQL runtime after bootstrap failure.', cleanupError, 'GraphqlLifecycleService');
      }

      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.resetGraphqlRuntimeState();
  }

  private async resetGraphqlRuntimeState(): Promise<void> {
    await this.unregisterWebSocketTransport();
    this.unregisterMiddleware();
    this.middlewareRegistered = false;
    this.executeGraphqlOperation = undefined;
    this.graphQLErrorConstructor = undefined;
    this.releaseGraphqlInstanceOfPatch?.();
    this.releaseGraphqlInstanceOfPatch = undefined;
    this.subscribeGraphqlOperation = undefined;
    this.yoga = undefined;
  }

  private resolveGraphiqlEnabled(): boolean {
    return this.options.graphiql ?? false;
  }

  private resolveIntrospectionEnabled(): boolean {
    return this.options.introspection ?? this.resolveGraphiqlEnabled();
  }

  private resolveWebSocketLimits(): GraphqlWebSocketLimits | undefined {
    const limits = this.options.subscriptions?.websocket?.limits;

    if (limits === false) {
      return undefined;
    }

    return {
      maxConnections: limits?.maxConnections ?? DEFAULT_GRAPHQL_WEBSOCKET_LIMITS.maxConnections,
      maxOperationsPerConnection:
        limits?.maxOperationsPerConnection ?? DEFAULT_GRAPHQL_WEBSOCKET_LIMITS.maxOperationsPerConnection,
      maxPayloadBytes: limits?.maxPayloadBytes ?? DEFAULT_GRAPHQL_WEBSOCKET_LIMITS.maxPayloadBytes,
    };
  }

  private resolveSchema(deps: GraphqlDeps): GraphQLSchemaType {
    this.releaseGraphqlInstanceOfPatch ??= installGraphqlInstanceOfPatch(deps.instanceOfModule);

    return resolveSchema(deps, this.options.schema, () => this.createCodeFirstSchema(deps), markAllowedCrossRealmGraphqlObjects);
  }

  private createCodeFirstSchema(deps: GraphqlDeps): GraphQLSchemaType {
    return createCodeFirstSchema(deps, this.runtimeContainer, this.discoverResolverDescriptors(), markAllowedCrossRealmGraphqlObjects);
  }

  private discoverResolverDescriptors(): ResolverDescriptor[] {
    return discoverResolverDescriptors(this.compiledModules, this.options);
  }

  private registerMiddleware(): void {
    for (const compiledModule of this.compiledModules) {
      if (!compiledModule.providerTokens.has(GraphqlLifecycleService)) {
        continue;
      }

      const middleware = compiledModule.definition.middleware ?? [];

      if (!middleware.includes(this.middleware)) {
        compiledModule.definition.middleware = [...middleware, this.middleware];
        continue;
      }

      compiledModule.definition.middleware = [...middleware];
    }
  }

  private unregisterMiddleware(): void {
    for (const compiledModule of this.compiledModules) {
      if (!compiledModule.providerTokens.has(GraphqlLifecycleService)) {
        continue;
      }

      const middleware = compiledModule.definition.middleware ?? [];
      const remaining = [];

      for (const entry of middleware) {
        if (entry !== this.middleware) {
          remaining.push(entry);
        }
      }

      compiledModule.definition.middleware = remaining;
    }
  }

  private buildGraphqlContext(
    request: Request,
    requestContextOverride?: GraphqlRequestContext,
    operationContainerOverride?: Container,
  ): GraphQLContext {
    const storedContext = this.requestContexts.get(request);
    const requestContext: GraphqlRequestContext = {
      connectionParams: requestContextOverride?.connectionParams,
      principal: requestContextOverride?.principal ?? storedContext?.principal,
      request: requestContextOverride?.request ?? storedContext?.request ?? buildFrameworkRequestFromFetchRequest(request),
      socket: requestContextOverride?.socket,
    };
    const customContext = this.options.context?.(requestContext) ?? {};
    const operationContainer = operationContainerOverride ?? this.getOrCreateOperationContainer(request);

    return {
      ...customContext,
      connectionParams: requestContext.connectionParams,
      principal: requestContext.principal,
      request: requestContext.request,
      socket: requestContext.socket,
      [GRAPHQL_OPERATION_CONTAINER]: operationContainer,
    };
  }

  private async registerWebSocketTransport(): Promise<void> {
    if (!this.isWebSocketTransportEnabled() || this.yoga === undefined || this.websocketTransport !== undefined) {
      return;
    }

    const { createNodeGraphqlWebSocketTransport } = await import('./node/graphql-websocket-transport.js');

    this.websocketTransport = await createNodeGraphqlWebSocketTransport({
      adapter: this.adapter,
      connectionInitWaitTimeoutMs: this.options.subscriptions?.websocket?.connectionInitWaitTimeoutMs,
      execute: (args: ExecutionArgs) => {
        if (!this.executeGraphqlOperation) {
          throw new Error('GraphQL execute function not initialized.');
        }

        return this.executeGraphqlOperation(args);
      },
      keepAliveMs: this.options.subscriptions?.websocket?.keepAliveMs,
      limits: this.resolveWebSocketLimits(),
      onComplete: (socketKey, operationId) => this.disposeWebSocketOperationContainer(socketKey, operationId),
      onDisconnect: (socketKey) => this.disposeAllWebSocketOperationContainers(socketKey),
      onSubscribe: (request) => this.handleWebSocketSubscribe(request),
      subscribe: (args: ExecutionArgs) => {
        if (!this.subscribeGraphqlOperation) {
          throw new Error('GraphQL subscribe function not initialized.');
        }

        return this.subscribeGraphqlOperation(args);
      },
    });
  }

  private async unregisterWebSocketTransport(): Promise<void> {
    if (this.websocketTransport) {
      try {
        await this.websocketTransport.dispose();
      } catch (error) {
        this.logger.error('Failed to dispose GraphQL websocket transport.', error, 'GraphqlLifecycleService');
      }
    }

    this.websocketTransport = undefined;

    for (const socketKey of this.websocketOperationContainers.keys()) {
      await this.disposeAllWebSocketOperationContainers(socketKey);
    }
  }

  private isWebSocketTransportEnabled(): boolean {
    return this.options.subscriptions?.websocket?.enabled === true;
  }

  private async handleWebSocketSubscribe(request: GraphqlNodeWebSocketSubscribeRequest): Promise<ExecutionArgs | readonly GraphQLErrorType[]> {
    const yoga = this.yoga;

    if (!yoga) {
      throw new Error('GraphQL server not initialized.');
    }

    const websocketLimitError = this.createWebSocketOperationLimitError(request.socket, request.operationId);

    if (websocketLimitError) {
      return [websocketLimitError];
    }

    const fetchRequest = toFetchRequest(request.request);
    const operationContainer = this.getOrCreateWebSocketOperationContainer(request.socket, request.operationId);
    const graphqlContext = this.buildGraphqlContext(
      fetchRequest,
      {
        connectionParams: request.connectionParams,
        request: request.request,
        socket: request.socket,
      },
      operationContainer,
    );

    try {
      const { contextFactory, parse, schema, validate } = yoga.getEnveloped({
        request: fetchRequest,
        [GRAPHQL_CONTEXT_OVERRIDE]: graphqlContext,
      });
      const document = parse(request.payload.query);
      const validationErrors = validate(schema, document);

      if (validationErrors.length > 0) {
        await this.disposeWebSocketOperationContainer(request.socket, request.operationId);
        return validationErrors;
      }

      return {
        contextValue: await contextFactory(),
        document,
        operationName: request.payload.operationName ?? undefined,
        schema,
        variableValues: request.payload.variables,
      };
    } catch (error) {
      await this.disposeWebSocketOperationContainer(request.socket, request.operationId);
      throw error;
    }
  }

  private createWebSocketOperationLimitError(socketKey: object, operationId: string): GraphQLErrorType | undefined {
    const limits = this.resolveWebSocketLimits();

    if (!limits) {
      return undefined;
    }

    const socketContainers = this.websocketOperationContainers.get(socketKey);

    if (socketContainers?.has(operationId) || (socketContainers?.size ?? 0) < limits.maxOperationsPerConnection) {
      return undefined;
    }

    const GraphQLError = this.graphQLErrorConstructor;

    if (!GraphQLError) {
      throw new Error('GraphQL error constructor not initialized.');
    }

    return new GraphQLError(
      `GraphQL websocket active operation count exceeds the configured limit of ${String(limits.maxOperationsPerConnection)}.`,
    );
  }

  private getOrCreateWebSocketOperationContainer(socketKey: object, operationId: string): Container {
    const existingSocketContainers = this.websocketOperationContainers.get(socketKey);

    if (existingSocketContainers?.has(operationId)) {
      return existingSocketContainers.get(operationId)!;
    }

    const created = this.runtimeContainer.createRequestScope();
    const socketContainers = existingSocketContainers ?? new Map<string, Container>();
    socketContainers.set(operationId, created);
    this.websocketOperationContainers.set(socketKey, socketContainers);
    return created;
  }

  private async disposeWebSocketOperationContainer(socketKey: object, operationId: string): Promise<void> {
    const socketContainers = this.websocketOperationContainers.get(socketKey);
    const operationContainer = socketContainers?.get(operationId);

    if (!operationContainer) {
      return;
    }

    socketContainers?.delete(operationId);

    if (socketContainers && socketContainers.size === 0) {
      this.websocketOperationContainers.delete(socketKey);
    }

    try {
      await operationContainer.dispose();
    } catch (error) {
      this.logger.error('Failed to dispose GraphQL websocket operation container.', error, 'GraphqlLifecycleService');
    }
  }

  private async disposeAllWebSocketOperationContainers(socketKey: object): Promise<void> {
    const socketContainers = this.websocketOperationContainers.get(socketKey);

    if (!socketContainers) {
      return;
    }

    this.websocketOperationContainers.delete(socketKey);

    for (const operationContainer of socketContainers.values()) {
      try {
        await operationContainer.dispose();
      } catch (error) {
        this.logger.error('Failed to dispose GraphQL websocket operation container.', error, 'GraphqlLifecycleService');
      }
    }
  }

  private getOrCreateOperationContainer(request: Request): Container {
    const existing = this.operationContainers.get(request);

    if (existing) {
      return existing;
    }

    const created = this.runtimeContainer.createRequestScope();
    this.operationContainers.set(request, created);
    return created;
  }

  private async disposeOperationContainer(request: Request): Promise<void> {
    const operationContainer = this.operationContainers.get(request);

    if (!operationContainer) {
      return;
    }

    this.operationContainers.delete(request);

    try {
      await operationContainer.dispose();
    } catch (error) {
      this.logger.error('Failed to dispose GraphQL operation container.', error, 'GraphqlLifecycleService');
    }
  }
}
