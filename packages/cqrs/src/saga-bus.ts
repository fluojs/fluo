import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, InvariantError, KonektiError, type Token } from '@konekti/core';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@konekti/runtime';

import { CqrsBusBase } from './discovery.js';
import { SagaExecutionError } from './errors.js';
import { createIsolatedEvent } from './event-clone.js';
import { getSagaMetadata } from './metadata.js';
import type { CqrsEventType, IEvent, ISaga, SagaDescriptor } from './types.js';

function isSaga(value: unknown): value is ISaga<IEvent> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { handle?: unknown }).handle === 'function';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class CqrsSagaLifecycleService extends CqrsBusBase implements OnApplicationBootstrap, OnApplicationShutdown {
  private descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly executionChains = new Map<Token, Promise<void>>();
  private readonly dispatchContext = new AsyncLocalStorage<Set<Token>>();

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDiscovered();
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.executionChains.values());

    this.executionChains.clear();
    this.handlerInstances.clear();
    this.descriptorsByEvent.clear();
    this.discovered = false;
    this.discoveryPromise = undefined;
  }

  async dispatch<TEvent extends IEvent>(event: TEvent): Promise<void> {
    await this.ensureDiscovered();

    const descriptors = this.matchSagaDescriptors(event);

    if (descriptors.length === 0) {
      return;
    }

    await Promise.all(descriptors.map((descriptor) => this.dispatchWithOrdering(descriptor, event)));
  }

  private matchSagaDescriptors(event: IEvent): SagaDescriptor[] {
    const descriptors: SagaDescriptor[] = [];

    for (const [eventType, eventDescriptors] of this.descriptorsByEvent.entries()) {
      if (event instanceof eventType) {
        descriptors.push(...eventDescriptors);
      }
    }

    return descriptors;
  }

  private async dispatchWithOrdering<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent): Promise<void> {
    const activeTokens = this.dispatchContext.getStore();

    if (activeTokens?.has(descriptor.token)) {
      await this.invokeSaga(descriptor, event);
      return;
    }

    const previous = this.executionChains.get(descriptor.token) ?? Promise.resolve();
    const current = previous.then(async () => {
      const nextTokens = new Set(activeTokens ?? []);
      nextTokens.add(descriptor.token);

      await this.dispatchContext.run(nextTokens, async () => {
        await this.invokeSaga(descriptor, event);
      });
    });

    this.executionChains.set(descriptor.token, current.catch(() => undefined));
    await current;
  }

  private async invokeSaga<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent): Promise<void> {
    const instance = await this.resolveHandlerInstance(descriptor.token);

    if (!isSaga(instance)) {
      throw new InvariantError(`Saga ${descriptor.targetType.name} must implement handle(event).`);
    }

    try {
      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event));
    } catch (error) {
      if (error instanceof KonektiError) {
        throw error;
      }

      throw new SagaExecutionError(
        `Saga ${descriptor.targetType.name} failed while handling ${descriptor.eventType.name}: ${toErrorMessage(error)}`,
      );
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
      this.descriptorsByEvent = this.discoverSagaDescriptors();
      this.handlerInstances.clear();

      for (const descriptors of this.descriptorsByEvent.values()) {
        for (const descriptor of descriptors) {
          await this.preloadHandlerInstance(descriptor.token);
        }
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverSagaDescriptors(): Map<CqrsEventType, SagaDescriptor[]> {
    const descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
    const seenByTarget = new WeakMap<Function, Set<CqrsEventType>>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getSagaMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @Saga() but is registered with ${candidate.scope} scope. Sagas are registered only for singleton providers.`,
          'CqrsSagaLifecycleService',
        );
        continue;
      }

      const seenEventTypes = seenByTarget.get(candidate.targetType) ?? new Set<CqrsEventType>();

      for (const eventType of metadata.eventTypes) {
        if (seenEventTypes.has(eventType)) {
          continue;
        }

        seenEventTypes.add(eventType);

        const descriptors = descriptorsByEvent.get(eventType) ?? [];

        if (!descriptors.some((descriptor) => descriptor.targetType === candidate.targetType)) {
          descriptors.push({
            eventType,
            moduleName: candidate.moduleName,
            targetType: candidate.targetType,
            token: candidate.token,
          });

          descriptorsByEvent.set(eventType, descriptors);
        }
      }

      seenByTarget.set(candidate.targetType, seenEventTypes);
    }

    return descriptorsByEvent;
  }
}
