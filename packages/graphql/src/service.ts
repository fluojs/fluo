import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Duplex } from 'node:stream';

import { Controller, Get, Post, type FrameworkRequest, type HttpApplicationAdapter, type Middleware, type MiddlewareContext, type Next } from '@konekti/http';
import { Inject } from '@konekti/core';
import type { Container } from '@konekti/di';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  HTTP_APPLICATION_ADAPTER,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@konekti/runtime';
import type {
  GraphQLError as GraphQLErrorType,
  GraphQLBoolean as GraphQLBooleanType,
  GraphQLFloat as GraphQLFloatType,
  GraphQLID as GraphQLIDType,
  GraphQLInt as GraphQLIntType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLString as GraphQLStringType,
  DocumentNode,
  ExecutionArgs,
} from 'graphql';
import { handleProtocols, type CompleteMessage, type Context as GraphqlWsServerContext, type OperationResult, type SubscribeMessage } from 'graphql-ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import type { Extra as GraphqlWsExtra } from 'graphql-ws/lib/use/ws';
import { WebSocketServer, type WebSocket } from 'ws';

import { discoverResolverDescriptors } from './discovery.js';
import { createCodeFirstSchema, resolveSchema } from './schema.js';
import { GRAPHQL_LIFECYCLE_SERVICE, GRAPHQL_MODULE_OPTIONS } from './tokens.js';
import { isGraphqlPath, toFetchRequest, writeFetchResponse } from './transport.js';
import { GRAPHQL_OPERATION_CONTAINER } from './types.js';
import type {
  GraphQLContext,
  GraphqlModuleOptions,
  GraphqlRequestContext,
  ResolverDescriptor,
} from './types.js';

const GRAPHQL_CONTEXT_OVERRIDE = Symbol('konekti.graphql.context.override');

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

type GraphqlInstanceOf = (value: unknown, constructor: { prototype?: { [Symbol.toStringTag]?: string } }) => boolean;

type NodeUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

interface NodeUpgradeServer {
  off(event: 'upgrade', listener: NodeUpgradeListener): this;
  on(event: 'upgrade', listener: NodeUpgradeListener): this;
}

type GraphqlWebSocketContext = GraphqlWsServerContext<Record<string, unknown>, GraphqlWsExtra>;

interface GraphqlSubscribePayload {
  operationName?: string | null;
  query: string;
  variables?: Record<string, unknown> | null;
}

function hasNodeUpgradeServer(value: unknown): value is NodeUpgradeServer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const server = value as { off?: unknown; on?: unknown };

  return typeof server.on === 'function' && typeof server.off === 'function';
}

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

function buildFrameworkRequestFromIncomingMessage(request: IncomingMessage): FrameworkRequest {
  const requestUrl = new URL(request.url ?? '/graphql', 'http://localhost');

  return {
    cookies: {},
    headers: request.headers,
    method: request.method ?? 'GET',
    params: {},
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    raw: request,
    url: requestUrl.pathname + requestUrl.search,
  };
}

function isConnectionParamsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error?.message === 'The server is not running') {
        resolve();
        return;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

interface GraphqlDeps {
  GraphQLError: typeof GraphQLErrorType;
  GraphQLBoolean: typeof GraphQLBooleanType;
  GraphQLFloat: typeof GraphQLFloatType;
  GraphQLID: typeof GraphQLIDType;
  GraphQLInt: typeof GraphQLIntType;
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: typeof GraphQLStringType;
  buildSchema: (source: string) => GraphQLSchemaType;
  createYoga: (options: Record<string, unknown>) => YogaLike;
  execute: (args: ExecutionArgs) => OperationResult;
  subscribe: (args: ExecutionArgs) => OperationResult;
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

async function loadGraphqlDeps(): Promise<GraphqlDeps> {
  const graphqlMod = runtimeRequire('graphql') as typeof import('graphql');
  const yogaMod = runtimeRequire('graphql-yoga') as typeof import('graphql-yoga');

  return {
    GraphQLError: graphqlMod.GraphQLError,
    GraphQLBoolean: graphqlMod.GraphQLBoolean,
    GraphQLFloat: graphqlMod.GraphQLFloat,
    GraphQLID: graphqlMod.GraphQLID,
    GraphQLInt: graphqlMod.GraphQLInt,
    GraphQLObjectType: graphqlMod.GraphQLObjectType,
    GraphQLSchema: graphqlMod.GraphQLSchema,
    GraphQLString: graphqlMod.GraphQLString,
    buildSchema: graphqlMod.buildSchema,
    createYoga: yogaMod.createYoga as (options: Record<string, unknown>) => YogaLike,
    execute: graphqlMod.execute,
    subscribe: graphqlMod.subscribe,
  };
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, GRAPHQL_MODULE_OPTIONS])
export class GraphqlLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private middlewareRegistered = false;
  private readonly operationContainers = new WeakMap<Request, Container>();
  private readonly websocketOperationContainers = new Map<object, Map<string, Container>>();
  private websocketDisposable: { dispose(): Promise<void> | void } | undefined;
  private websocketServer: WebSocketServer | undefined;
  private websocketUpgradeListener: NodeUpgradeListener | undefined;
  private websocketUpgradeServer: NodeUpgradeServer | undefined;
  private executeGraphqlOperation: ((args: ExecutionArgs) => OperationResult) | undefined;
  private subscribeGraphqlOperation: ((args: ExecutionArgs) => OperationResult) | undefined;
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
        try {
          const fetchResponse = await graphqlRequestContextStorage.run(
            {
              principal: context.requestContext.principal,
              request: context.request,
            },
            () => yoga.fetch(fetchRequest),
          );

          await writeFetchResponse(fetchResponse, context.response);
        } finally {
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

    const deps = await loadGraphqlDeps();
    const schema = this.resolveSchema(deps);
    this.executeGraphqlOperation = deps.execute;
    this.subscribeGraphqlOperation = deps.subscribe;

    this.yoga = deps.createYoga({
      context: (contextValue: { request: Request; [GRAPHQL_CONTEXT_OVERRIDE]?: GraphQLContext }) =>
        contextValue[GRAPHQL_CONTEXT_OVERRIDE] ?? this.buildGraphqlContext(contextValue.request),
      graphqlEndpoint: '/graphql',
      graphiql: this.resolveGraphiqlEnabled(),
      ...(this.options.plugins && this.options.plugins.length > 0 ? { plugins: this.options.plugins } : {}),
      schema,
    });

    this.registerWebSocketTransport();

    this.registerMiddleware();
    this.middlewareRegistered = true;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unregisterWebSocketTransport();
    this.unregisterMiddleware();
    this.middlewareRegistered = false;
    this.executeGraphqlOperation = undefined;
    this.subscribeGraphqlOperation = undefined;
    this.yoga = undefined;
  }

  private resolveGraphiqlEnabled(): boolean {
    return this.options.graphiql ?? false;
  }

  private resolveSchema(deps: GraphqlDeps): GraphQLSchemaType {
    if (this.options.schema && typeof this.options.schema === 'object') {
      patchGraphqlInstanceOf();
    }

    return resolveSchema(deps, this.options.schema, () => this.createCodeFirstSchema(deps), markAllowedCrossRealmGraphqlObjects);
  }

  private createCodeFirstSchema(deps: GraphqlDeps): GraphQLSchemaType {
    return createCodeFirstSchema(deps, this.runtimeContainer, this.discoverResolverDescriptors());
  }

  private discoverResolverDescriptors(): ResolverDescriptor[] {
    return discoverResolverDescriptors(this.compiledModules, this.options);
  }

  private registerMiddleware(): void {
    for (const compiledModule of this.compiledModules) {
      if (!compiledModule.providerTokens.has(GRAPHQL_LIFECYCLE_SERVICE)) {
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
      if (!compiledModule.providerTokens.has(GRAPHQL_LIFECYCLE_SERVICE)) {
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
    const storedContext = graphqlRequestContextStorage.getStore();
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

  private registerWebSocketTransport(): void {
    if (!this.isWebSocketTransportEnabled() || this.yoga === undefined || this.websocketUpgradeListener !== undefined) {
      return;
    }

    const upgradeServer = this.resolveUpgradeServer();
    const websocketServer = new WebSocketServer({
      handleProtocols: (protocols) => handleProtocols(protocols),
      noServer: true,
    });
    const upgradeListener: NodeUpgradeListener = (request, socket, head) => {
      const targetPath = new URL(request.url ?? '/', 'http://localhost').pathname;

      if (!isGraphqlPath(targetPath)) {
        return;
      }

      websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        websocketServer.emit('connection', websocket, request);
      });
    };

    const websocketDisposable = useServer(
      {
        connectionInitWaitTimeout: this.options.subscriptions?.websocket?.connectionInitWaitTimeoutMs,
        execute: (args: ExecutionArgs) => {
          if (!this.executeGraphqlOperation) {
            throw new Error('GraphQL execute function not initialized.');
          }

          return this.executeGraphqlOperation(args);
        },
        onComplete: async (context: GraphqlWebSocketContext, message: CompleteMessage) => {
          await this.disposeWebSocketOperationContainer(context.extra.socket, message.id);
        },
        onDisconnect: async (context: GraphqlWebSocketContext) => {
          await this.disposeAllWebSocketOperationContainers(context.extra.socket);
        },
        onSubscribe: async (context: GraphqlWebSocketContext, message: SubscribeMessage) =>
          this.handleWebSocketSubscribe(context, message.id, message.payload),
        subscribe: (args: ExecutionArgs) => {
          if (!this.subscribeGraphqlOperation) {
            throw new Error('GraphQL subscribe function not initialized.');
          }

          return this.subscribeGraphqlOperation(args);
        },
      },
      websocketServer,
      this.options.subscriptions?.websocket?.keepAliveMs,
    );

    upgradeServer.on('upgrade', upgradeListener);

    this.websocketDisposable = websocketDisposable;
    this.websocketServer = websocketServer;
    this.websocketUpgradeListener = upgradeListener;
    this.websocketUpgradeServer = upgradeServer;
  }

  private async unregisterWebSocketTransport(): Promise<void> {
    if (this.websocketUpgradeListener && this.websocketUpgradeServer) {
      this.websocketUpgradeServer.off('upgrade', this.websocketUpgradeListener);
    }

    this.websocketUpgradeListener = undefined;
    this.websocketUpgradeServer = undefined;

    if (this.websocketServer) {
      for (const client of this.websocketServer.clients) {
        client.terminate();
      }
    }

    if (this.websocketDisposable) {
      try {
        await this.websocketDisposable.dispose();
      } catch (error) {
        this.logger.error('Failed to dispose GraphQL websocket transport.', error, 'GraphqlLifecycleService');
      }
    }

    this.websocketDisposable = undefined;

    if (this.websocketServer) {
      try {
        await closeWebSocketServer(this.websocketServer);
      } catch (error) {
        this.logger.error('Failed to close GraphQL websocket server.', error, 'GraphqlLifecycleService');
      }
    }

    this.websocketServer = undefined;

    for (const socketKey of this.websocketOperationContainers.keys()) {
      await this.disposeAllWebSocketOperationContainers(socketKey);
    }
  }

  private isWebSocketTransportEnabled(): boolean {
    return this.options.subscriptions?.websocket?.enabled === true;
  }

  private resolveUpgradeServer(): NodeUpgradeServer {
    if (typeof this.adapter.getServer !== 'function') {
      throw new Error(
        'GraphQL websocket subscriptions require an HTTP adapter with getServer(). Use the Node HTTP adapter or provide a compatible adapter implementation.',
      );
    }

    const server = this.adapter.getServer();

    if (!hasNodeUpgradeServer(server)) {
      throw new Error(
        'GraphQL websocket subscriptions require adapter.getServer() to return a Node HTTP/S server that supports upgrade listeners.',
      );
    }

    return server;
  }

  private async handleWebSocketSubscribe(
    context: GraphqlWsServerContext<Record<string, unknown>, GraphqlWsExtra>,
    operationId: string,
    payload: GraphqlSubscribePayload,
  ): Promise<ExecutionArgs | readonly GraphQLErrorType[]> {
    const yoga = this.yoga;

    if (!yoga) {
      throw new Error('GraphQL server not initialized.');
    }

    const frameworkRequest = buildFrameworkRequestFromIncomingMessage(context.extra.request);
    const fetchRequest = toFetchRequest(frameworkRequest);
    const operationContainer = this.getOrCreateWebSocketOperationContainer(context.extra.socket, operationId);
    const graphqlContext = this.buildGraphqlContext(
      fetchRequest,
      {
        connectionParams: isConnectionParamsRecord(context.connectionParams) ? context.connectionParams : undefined,
        request: frameworkRequest,
        socket: context.extra.socket,
      },
      operationContainer,
    );

    try {
      const { contextFactory, parse, schema, validate } = yoga.getEnveloped({
        request: fetchRequest,
        [GRAPHQL_CONTEXT_OVERRIDE]: graphqlContext,
      });
      const document = parse(payload.query);
      const validationErrors = validate(schema, document);

      if (validationErrors.length > 0) {
        await this.disposeWebSocketOperationContainer(context.extra.socket, operationId);
        return validationErrors;
      }

      return {
        contextValue: await contextFactory(),
        document,
        operationName: payload.operationName ?? undefined,
        schema,
        variableValues: payload.variables,
      };
    } catch (error) {
      await this.disposeWebSocketOperationContainer(context.extra.socket, operationId);
      throw error;
    }
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
