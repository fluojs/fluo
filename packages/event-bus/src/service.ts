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

interface InvocationBound {
  cleanup(): void;
  promise: Promise<never>;
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
    const matchingDescriptors = this.matchEventDescriptors(event);

    if (matchingDescriptors.length === 0) {
      return;
    }

    const publishOptions = this.resolvePublishOptions(options);
    if (!publishOptions.waitForHandlers) {
      const backgroundTasks = this.createBackgroundInvocationTasks(matchingDescriptors, event, publishOptions.signal);
      this.runInvocationTasksInBackground(backgroundTasks);

      return;
    }

    const invocationTasks = this.createInvocationTasks(matchingDescriptors, event, publishOptions);

    await Promise.allSettled(invocationTasks);
  }

  private matchEventDescriptors(event: object): EventHandlerDescriptor[] {
    return this.descriptors.filter((descriptor) => event instanceof descriptor.eventType);
  }

  private createInvocationTasks(
    descriptors: EventHandlerDescriptor[],
    event: object,
    publishOptions: ResolvedPublishOptions,
  ): Promise<void>[] {
    return descriptors.map((descriptor) => this.invokeHandlerWithBounds(descriptor, event, publishOptions));
  }

  private createBackgroundInvocationTasks(
    descriptors: EventHandlerDescriptor[],
    event: object,
    signal: AbortSignal | undefined,
  ): Promise<void>[] {
    return descriptors.map((descriptor) => this.invokeHandlerInBackground(descriptor, event, signal));
  }

  private runInvocationTasksInBackground(invocationTasks: Promise<void>[]): void {
    for (const task of invocationTasks) {
      void task;
    }
  }

  private async invokeHandlerInBackground(
    descriptor: EventHandlerDescriptor,
    event: object,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal?.aborted) {
      this.logPublishCancelledBeforeDispatch(descriptor);
      return;
    }

    await this.invokeHandler(descriptor, event);
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
      this.logPublishCancelledBeforeDispatch(descriptor);
      return;
    }

    const invocation = this.invokeHandler(descriptor, event);

    try {
      await this.awaitInvocationBounds(invocation, publishOptions);
    } catch (error) {
      this.logBoundedInvocationError(descriptor, error);
    }
  }

  private logPublishCancelledBeforeDispatch(descriptor: EventHandlerDescriptor): void {
    this.logger.warn(
      `Event publish was cancelled before dispatching handler ${descriptor.targetName}.${descriptor.methodName}.`,
      'EventBusLifecycleService',
    );
  }

  private logBoundedInvocationError(descriptor: EventHandlerDescriptor, error: unknown): void {
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

    const bounds = this.createInvocationBounds(timeoutMs, signal);

    try {
      await Promise.race([invocation, ...bounds.map((bound) => bound.promise)]);
    } finally {
      for (const bound of bounds) {
        bound.cleanup();
      }
    }
  }

  private createInvocationBounds(
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ): InvocationBound[] {
    const bounds: InvocationBound[] = [];

    if (timeoutMs !== undefined) {
      bounds.push(this.createTimeoutBound(timeoutMs));
    }

    if (signal) {
      if (signal.aborted) {
        throw new EventPublishAbortError();
      }

      bounds.push(this.createAbortBound(signal));
    }

    return bounds;
  }

  private createTimeoutBound(timeoutMs: number): InvocationBound {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    return {
      cleanup(): void {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
      promise: new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new EventPublishTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    };
  }

  private createAbortBound(signal: AbortSignal): InvocationBound {
    let abortListener: (() => void) | undefined;

    return {
      cleanup(): void {
        if (abortListener) {
          signal.removeEventListener('abort', abortListener);
        }
      },
      promise: new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          reject(new EventPublishAbortError());
        };

        signal.addEventListener('abort', abortListener, { once: true });
      }),
    };
  }

  private discoverHandlerDescriptors(): EventHandlerDescriptor[] {
    const seen = new WeakMap<Function, Map<MetadataPropertyKey, Set<EventType>>>();
    const descriptors: EventHandlerDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getEventHandlerMetadataEntries(candidate.targetType.prototype);

      if (this.shouldSkipNonSingletonCandidate(candidate, entries.length)) {
        continue;
      }

      for (const entry of entries) {
        const eventType = entry.metadata.eventType;

        if (this.isDuplicateHandlerRegistration(seen, candidate.targetType, entry.propertyKey, eventType)) {
          continue;
        }

        descriptors.push(this.createHandlerDescriptor(candidate, entry.propertyKey, eventType));
      }
    }

    return descriptors;
  }

  private shouldSkipNonSingletonCandidate(candidate: DiscoveryCandidate, entryCount: number): boolean {
    if (candidate.scope === 'singleton') {
      return false;
    }

    if (entryCount > 0) {
      this.logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @OnEvent() methods but is registered with ${candidate.scope} scope. Event handlers are registered only for singleton providers.`,
        'EventBusLifecycleService',
      );
    }

    return true;
  }

  private isDuplicateHandlerRegistration(
    seen: WeakMap<Function, Map<MetadataPropertyKey, Set<EventType>>>,
    targetType: Function,
    methodKey: MetadataPropertyKey,
    eventType: EventType,
  ): boolean {
    let methodsByKey = seen.get(targetType);

    if (!methodsByKey) {
      methodsByKey = new Map<MetadataPropertyKey, Set<EventType>>();
      seen.set(targetType, methodsByKey);
    }

    let seenEventTypes = methodsByKey.get(methodKey);

    if (!seenEventTypes) {
      seenEventTypes = new Set<EventType>();
      methodsByKey.set(methodKey, seenEventTypes);
    }

    if (seenEventTypes.has(eventType)) {
      return true;
    }

    seenEventTypes.add(eventType);
    return false;
  }

  private createHandlerDescriptor(
    candidate: DiscoveryCandidate,
    methodKey: MetadataPropertyKey,
    eventType: EventType,
  ): EventHandlerDescriptor {
    return {
      eventType,
      methodKey,
      methodName: methodKeyToName(methodKey),
      moduleName: candidate.moduleName,
      targetName: candidate.targetType.name,
      token: candidate.token,
    };
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
