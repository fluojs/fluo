import { Inject, InvariantError } from '@konekti/core';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { DuplicateQueryHandlerError, QueryHandlerNotFoundException } from './errors.js';
import { getQueryHandlerMetadata } from './metadata.js';
import { CqrsBusBase, createDuplicateHandlerMessage } from './discovery.js';
import type {
  IQuery,
  IQueryHandler,
  QueryBus,
  QueryHandlerDescriptor,
  QueryType,
} from './types.js';

function isQueryHandler(value: unknown): value is IQueryHandler<IQuery<unknown>, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { execute?: unknown }).execute === 'function';
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class QueryBusLifecycleService extends CqrsBusBase implements QueryBus, OnApplicationBootstrap {
  private descriptors = new Map<QueryType, QueryHandlerDescriptor>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDiscovered();
  }

  async execute<TQuery extends IQuery<TResult>, TResult = unknown>(query: TQuery): Promise<TResult> {
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

    return await instance.execute(query) as TResult;
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
    const seenByTarget = new WeakMap<Function, Set<QueryType>>();

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

      const seenQueryTypes = seenByTarget.get(candidate.targetType) ?? new Set<QueryType>();

      if (seenQueryTypes.has(metadata.queryType)) {
        continue;
      }

      seenQueryTypes.add(metadata.queryType);
      seenByTarget.set(candidate.targetType, seenQueryTypes);

      const existing = descriptors.get(metadata.queryType);

      if (existing && existing.targetType !== candidate.targetType) {
        throw new DuplicateQueryHandlerError(
          createDuplicateHandlerMessage('query', metadata.queryType, existing, {
            moduleName: candidate.moduleName,
            targetType: candidate.targetType,
          }),
        );
      }

      if (!existing) {
        descriptors.set(metadata.queryType, {
          moduleName: candidate.moduleName,
          queryType: metadata.queryType,
          targetType: candidate.targetType,
          token: candidate.token,
        });
      }
    }

    return descriptors;
  }
}
