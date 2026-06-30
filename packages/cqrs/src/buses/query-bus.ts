import { Inject, InvariantError } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type {
  ApplicationLogger,
  CompiledModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  RuntimeCleanupRegistration,
} from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CLEANUP_REGISTRATION, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import { CqrsBusBase, createDuplicateHandlerMessage, isSameHandlerRegistration } from '../discovery.js';
import { DuplicateQueryHandlerError, QueryHandlerNotFoundException } from '../errors.js';
import { getQueryHandlerMetadata } from '../metadata.js';
import type {
  CqrsDispatchContext,
  IQuery,
  IQueryHandler,
  QueryBus,
  QueryHandlerDescriptor,
  QueryType,
} from '../types.js';

function isQueryHandler(value: unknown): value is IQueryHandler<IQuery<unknown>, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { execute?: unknown }).execute === 'function';
}

/**
 * Discovers and executes query handlers during bootstrap and runtime dispatch.
 *
 * The query bus resolves singleton handlers only, warns on unsupported scopes,
 * and preserves the one-query-to-one-handler contract used by the CQRS surface.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, RUNTIME_CLEANUP_REGISTRATION)
export class QueryBusLifecycleService extends CqrsBusBase implements QueryBus, OnApplicationBootstrap, OnApplicationShutdown {
  private descriptors = new Map<QueryType, QueryHandlerDescriptor>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private unregisterShutdownStartCleanup: (() => void) | undefined;

  constructor(
    runtimeContainer: Container,
    compiledModules: readonly CompiledModule[],
    logger: ApplicationLogger,
    registerRuntimeCleanup: RuntimeCleanupRegistration = () => () => undefined,
  ) {
    super(runtimeContainer, compiledModules, logger);

    this.unregisterShutdownStartCleanup = registerRuntimeCleanup(() => {
      this.markApplicationShutdownStarted();
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.lifecycleState = 'discovering';

    try {
      await this.ensureDiscovered();
      this.lifecycleState = 'ready';
    } catch (error) {
      this.lifecycleState = 'failed';
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.markApplicationShutdownStarted();
    this.unregisterShutdownStartCleanup?.();
    this.unregisterShutdownStartCleanup = undefined;
    this.descriptors.clear();
    this.handlerInstances.clear();
    this.discovered = false;
    this.discoveryPromise = undefined;
    this.lifecycleState = 'stopped';
  }

  /**
   * Executes one query by dispatching it to the discovered handler for its constructor.
   *
   * @param query Query instance to execute.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns The resolved handler result.
   *
   * @throws {QueryHandlerNotFoundException} When no handler is registered for the query type.
   * @throws {InvariantError} When the resolved provider does not implement `execute(query)`.
   */
  async execute<TQuery extends IQuery<TResult>, TResult = unknown>(query: TQuery, context?: CqrsDispatchContext): Promise<TResult> {
    this.assertAcceptingNewWork('execute');
    await this.ensureDiscovered();

    const queryType = query.constructor as QueryType<TResult, TQuery>;
    const descriptor = this.descriptors.get(queryType);

    if (!descriptor) {
      throw new QueryHandlerNotFoundException(`No query handler registered for ${queryType.name}.`);
    }

    const instance = await this.resolveHandlerInstance(descriptor.token);

    if (!isQueryHandler(instance)) {
      throw new InvariantError(`Query handler ${descriptor.targetType.name} must implement execute(query).`);
    }

    return await instance.execute(query, context) as TResult;
  }

  private assertAcceptingNewWork(operation: 'execute'): void {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      throw new InvariantError(`CQRS query bus cannot ${operation} after shutdown has started.`);
    }
  }

  private markApplicationShutdownStarted(): void {
    if (this.lifecycleState !== 'stopped') {
      this.lifecycleState = 'stopping';
    }
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) {
      return;
    }

    if (this.discoveryPromise) {
      await this.discoveryPromise;
      return;
    }

    this.discoveryPromise = this.discoverHandlers();
    await this.discoveryPromise;
  }

  private async discoverHandlers(): Promise<void> {
    try {
      this.descriptors = this.discoverQueryDescriptors();
      this.handlerInstances.clear();

      for (const descriptor of this.descriptors.values()) {
        await this.preloadHandlerInstance(descriptor.token);
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverQueryDescriptors(): Map<QueryType, QueryHandlerDescriptor> {
    const descriptors = new Map<QueryType, QueryHandlerDescriptor>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getQueryHandlerMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @QueryHandler() but is registered with ${candidate.scope} scope. Query handlers are registered only for singleton providers.`,
          'QueryBusLifecycleService',
        );
        continue;
      }

      const existing = descriptors.get(metadata.queryType);
      const nextDescriptor = {
        moduleName: candidate.moduleName,
        targetType: candidate.targetType,
        token: candidate.token,
      };

      if (existing) {
        if (isSameHandlerRegistration(existing, nextDescriptor)) {
          continue;
        }

        throw new DuplicateQueryHandlerError(
          createDuplicateHandlerMessage('query', metadata.queryType, existing, nextDescriptor),
        );
      }

      descriptors.set(metadata.queryType, {
        queryType: metadata.queryType,
        ...nextDescriptor,
      });
    }

    return descriptors;
  }
}
