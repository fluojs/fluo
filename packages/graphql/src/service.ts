import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';

import { Controller, Get, Post, type FrameworkRequest, type Middleware, type MiddlewareContext, type Next } from '@konekti/http';
import { Inject } from '@konekti/core';
import type { Container } from '@konekti/di';
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
  GraphQLError as GraphQLErrorType,
  GraphQLBoolean as GraphQLBooleanType,
  GraphQLFloat as GraphQLFloatType,
  GraphQLID as GraphQLIDType,
  GraphQLInt as GraphQLIntType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLString as GraphQLStringType,
} from 'graphql';

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

type YogaLike = {
  fetch(request: Request): Promise<Response>;
};

type GraphqlInstanceOf = (value: unknown, constructor: { prototype?: { [Symbol.toStringTag]?: string } }) => boolean;

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
  patchGraphqlInstanceOf();

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
  };
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, GRAPHQL_MODULE_OPTIONS])
export class GraphqlLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private middlewareRegistered = false;
  private readonly operationContainers = new WeakMap<Request, Container>();
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
    private readonly options: GraphqlModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.middlewareRegistered) {
      return;
    }

    const deps = await loadGraphqlDeps();
    const schema = this.resolveSchema(deps);

    this.yoga = deps.createYoga({
      context: ({ request }: { request: Request }) => this.buildGraphqlContext(request),
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
    return resolveSchema(deps, this.options.schema, () => this.createCodeFirstSchema(deps), markAllowedCrossRealmGraphqlObjects);
  }

  private createCodeFirstSchema(deps: GraphqlDeps): GraphQLSchemaType {
    return createCodeFirstSchema(deps, this.runtimeContainer, this.discoverResolverDescriptors());
  }

  private discoverResolverDescriptors(): ResolverDescriptor[] {
    return discoverResolverDescriptors(this.compiledModules, this.options, this.logger);
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
    const requestUrl = new URL(request.url);
    const fallbackRequest: FrameworkRequest = {
      cookies: {},
      headers: {},
      method: request.method,
      params: {},
      path: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      raw: request,
      url: requestUrl.pathname + requestUrl.search,
    };

    const storedContext = graphqlRequestContextStorage.getStore();
    const requestContext: GraphqlRequestContext = {
      principal: storedContext?.principal,
      request: storedContext?.request ?? fallbackRequest,
    };
    const customContext = this.options.context?.(requestContext) ?? {};
    const operationContainer = this.getOrCreateOperationContainer(request);

    return {
      ...customContext,
      principal: requestContext.principal,
      request: requestContext.request,
      [GRAPHQL_OPERATION_CONTAINER]: operationContainer,
    };
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
