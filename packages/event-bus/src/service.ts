import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { getEventHandlerMetadataEntries } from './metadata.js';
import { EVENT_BUS_OPTIONS } from './tokens.js';
import type {
  EventBus,
  EventBusModuleOptions,
  EventHandlerDescriptor,
  EventPublishOptions,
  EventType,
} from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface ResolvedPublishOptions {
  signal: AbortSignal | undefined;
  timeoutMs: number | undefined;
  waitForHandlers: boolean;
}

class EventPublishTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Event publish timed out after ${String(timeoutMs)}ms.`);
  }
}

class EventPublishAbortError extends Error {
  constructor() {
    super('Event publish was aborted.');
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

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, EVENT_BUS_OPTIONS])
export class EventBusLifecycleService implements EventBus, OnApplicationBootstrap {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly handlerInstances = new Map<Token, Promise<unknown>>();

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly moduleOptions: EventBusModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDiscovered();
  }

  async publish(event: object, options?: EventPublishOptions): Promise<void> {
    await this.ensureDiscovered();
    const matchingDescriptors = this.descriptors.filter((descriptor) => event instanceof descriptor.eventType);

    if (matchingDescriptors.length === 0) {
      return;
    }

    const publishOptions = this.resolvePublishOptions(options);
    const invocationTasks = matchingDescriptors.map((descriptor) =>
      this.invokeHandlerWithBounds(descriptor, event, publishOptions),
    );

    if (!publishOptions.waitForHandlers) {
      for (const task of invocationTasks) {
        void task;
      }

      return;
    }

    await Promise.allSettled(invocationTasks);
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) {
      return;
    }

    if (this.discoveryPromise) {
      await this.discoveryPromise;
      return;
    }

    if (this.compiledModules.length === 0) {
      this.logger.warn(
        'EventBus.publish() was called before onApplicationBootstrap completed. Handlers may not yet be registered.',
        'EventBusLifecycleService',
      );
    }

    this.discoveryPromise = this.discoverHandlers();
    await this.discoveryPromise;
  }

  private resolvePublishOptions(options?: EventPublishOptions): ResolvedPublishOptions {
    const defaults = this.moduleOptions.publish;
    const timeoutMs = this.normalizeTimeoutMs(options?.timeoutMs ?? defaults?.timeoutMs);
    const waitForHandlers = options?.waitForHandlers ?? defaults?.waitForHandlers ?? true;

    return {
      signal: options?.signal,
      timeoutMs,
      waitForHandlers,
    };
  }

  private normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return undefined;
    }

    return Math.floor(timeoutMs);
  }

  private async discoverHandlers(): Promise<void> {
    try {
      this.descriptors = this.discoverHandlerDescriptors();
      this.handlerInstances.clear();
      await this.preloadHandlerInstances(this.descriptors);
      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private async preloadHandlerInstances(descriptors: EventHandlerDescriptor[]): Promise<void> {
    for (const descriptor of descriptors) {
      if (this.handlerInstances.has(descriptor.token)) {
        continue;
      }

      await this.resolveHandlerInstance(descriptor);
    }
  }

  private async invokeHandlerWithBounds(
    descriptor: EventHandlerDescriptor,
    event: object,
    publishOptions: ResolvedPublishOptions,
  ): Promise<void> {
    if (publishOptions.signal?.aborted) {
      this.logger.warn(
        `Event publish was cancelled before dispatching handler ${descriptor.targetName}.${descriptor.methodName}.`,
        'EventBusLifecycleService',
      );
      return;
    }

    const invocation = this.invokeHandler(descriptor, event);

    try {
      await this.awaitInvocationBounds(invocation, publishOptions);
    } catch (error) {
      if (error instanceof EventPublishTimeoutError) {
        this.logger.warn(
          `Event handler ${descriptor.targetName}.${descriptor.methodName} exceeded publish timeout of ${String(error.timeoutMs)}ms.`,
          'EventBusLifecycleService',
        );
        return;
      }

      if (error instanceof EventPublishAbortError) {
        this.logger.warn(
          `Event publish was cancelled while waiting for handler ${descriptor.targetName}.${descriptor.methodName}.`,
          'EventBusLifecycleService',
        );
        return;
      }

      this.logger.error(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} failed while applying publish bounds.`,
        error,
        'EventBusLifecycleService',
      );
    }
  }

  private async awaitInvocationBounds(
    invocation: Promise<void>,
    publishOptions: ResolvedPublishOptions,
  ): Promise<void> {
    const timeoutMs = publishOptions.timeoutMs;
    const signal = publishOptions.signal;

    if (timeoutMs === undefined && !signal) {
      await invocation;
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const bounds: Array<Promise<never>> = [];

    if (timeoutMs !== undefined) {
      bounds.push(
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new EventPublishTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      );
    }

    if (signal) {
      if (signal.aborted) {
        throw new EventPublishAbortError();
      }

      bounds.push(
        new Promise<never>((_resolve, reject) => {
          abortListener = () => {
            reject(new EventPublishAbortError());
          };
          signal.addEventListener('abort', abortListener, { once: true });
        }),
      );
    }

    try {
      await Promise.race([invocation, ...bounds]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    }
  }

  private discoverHandlerDescriptors(): EventHandlerDescriptor[] {
    const seen = new WeakMap<Function, Map<MetadataPropertyKey, Set<EventType>>>();
    const descriptors: EventHandlerDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getEventHandlerMetadataEntries(candidate.targetType.prototype);

      if (candidate.scope !== 'singleton') {
        if (entries.length > 0) {
          this.logger.warn(
            `${candidate.targetType.name} in module ${candidate.moduleName} declares @OnEvent() methods but is registered with ${candidate.scope} scope. Event handlers are registered only for singleton providers.`,
            'EventBusLifecycleService',
          );
        }

        continue;
      }

      for (const entry of entries) {
        const methodName = methodKeyToName(entry.propertyKey);
        const eventType = entry.metadata.eventType;
        let methodsByKey = seen.get(candidate.targetType);

        if (!methodsByKey) {
          methodsByKey = new Map<MetadataPropertyKey, Set<EventType>>();
          seen.set(candidate.targetType, methodsByKey);
        }

        let seenEventTypes = methodsByKey.get(entry.propertyKey);

        if (!seenEventTypes) {
          seenEventTypes = new Set<EventType>();
          methodsByKey.set(entry.propertyKey, seenEventTypes);
        }

        if (seenEventTypes.has(eventType)) {
          continue;
        }

        seenEventTypes.add(eventType);

        descriptors.push({
          eventType,
          methodKey: entry.propertyKey,
          methodName,
          moduleName: candidate.moduleName,
          targetName: candidate.targetType.name,
          token: candidate.token,
        });
      }
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

  private async invokeHandler(descriptor: EventHandlerDescriptor, event: object): Promise<void> {
    const instance = await this.resolveHandlerInstance(descriptor);

    if (instance === undefined) {
      return;
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'EventBusLifecycleService',
      );
      return;
    }

    try {
      await Promise.resolve((value as (this: unknown, event: object) => Promise<void>).call(instance, event));
    } catch (error) {
      this.logger.error(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} failed.`,
        error,
        'EventBusLifecycleService',
      );
    }
  }

  private async resolveHandlerInstance(descriptor: EventHandlerDescriptor): Promise<unknown | undefined> {
    const cached = this.handlerInstances.get(descriptor.token);

    if (cached) {
      return await cached;
    }

    const resolving = this.runtimeContainer.resolve(descriptor.token);
    this.handlerInstances.set(descriptor.token, resolving);

    try {
      return await resolving;
    } catch (error) {
      this.handlerInstances.delete(descriptor.token);
      this.logger.error(
        `Failed to resolve event handler target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'EventBusLifecycleService',
      );
      return undefined;
    }
  }
}
