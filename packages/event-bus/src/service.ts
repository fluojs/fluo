import { Inject, fallbackClone, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import {
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@konekti/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@konekti/runtime/internal';

import { getEventHandlerMetadataEntries } from './metadata.js';
import { createEventBusPlatformStatusSnapshot } from './status.js';
import { EVENT_BUS_OPTIONS } from './tokens.js';
import type {
  EventBus,
  EventBusModuleOptions,
  EventBusTransport,
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

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}

function createIsolatedEvent<TEvent extends object>(eventType: EventType<TEvent>, source: unknown): TEvent {
  const clonedPayload = cloneValue(source);

  if (typeof clonedPayload !== 'object' || clonedPayload === null) {
    return clonedPayload as TEvent;
  }

  return Object.assign(Object.create(eventType.prototype) as object, clonedPayload) as TEvent;
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
export class EventBusLifecycleService implements EventBus, OnApplicationBootstrap, OnApplicationShutdown {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private readonly handlerInstances = new Map<Token, Promise<unknown>>();
  private readonly subscribedChannels = new Set<string>();
  private transportCloseFailures = 0;
  private transportPublishFailures = 0;
  private transportSubscribeFailures = 0;
  private readonly transport: EventBusTransport | undefined;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly moduleOptions: EventBusModuleOptions,
  ) {
    this.transport = moduleOptions.transport;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.lifecycleState = 'discovering';

    try {
      await this.ensureDiscovered();
      await this.subscribeTransportChannels();
      this.lifecycleState = 'ready';
    } catch (error) {
      this.lifecycleState = 'failed';
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'stopping';

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        this.transportCloseFailures += 1;
        this.lifecycleState = 'failed';
        this.logger.error('EventBusTransport failed to close.', error, 'EventBusLifecycleService');
      }
    }

    if (this.lifecycleState !== 'failed') {
      this.lifecycleState = 'stopped';
    }
  }

  createPlatformStatusSnapshot() {
    return createEventBusPlatformStatusSnapshot({
      handlersDiscovered: this.descriptors.length,
      lifecycleState: this.lifecycleState,
      subscribedChannels: this.subscribedChannels.size,
      transportCloseFailures: this.transportCloseFailures,
      transportConfigured: this.transport !== undefined,
      transportPublishFailures: this.transportPublishFailures,
      transportSubscribeFailures: this.transportSubscribeFailures,
      waitForHandlersDefault: this.moduleOptions.publish?.waitForHandlers ?? true,
    });
  }

  async publish(event: object, options?: EventPublishOptions): Promise<void> {
    await this.ensureDiscovered();
    const matchingDescriptors = this.matchEventDescriptors(event);
    const publishOptions = this.resolvePublishOptions(options);

    const transportPayload = createIsolatedEvent(event.constructor as EventType, event);
    const transportPublish = this.publishToTransport(transportPayload, matchingDescriptors);

    if (!publishOptions.waitForHandlers) {
      const backgroundTasks = this.createBackgroundInvocationTasks(matchingDescriptors, event, publishOptions.signal);
      this.runInvocationTasksInBackground([...backgroundTasks, transportPublish]);

      return;
    }

    if (matchingDescriptors.length === 0) {
      await transportPublish;

      return;
    }

    const invocationTasks = this.createInvocationTasks(matchingDescriptors, event, publishOptions);

    await Promise.allSettled([...invocationTasks, transportPublish]);
  }

  private matchEventDescriptors(event: object): EventHandlerDescriptor[] {
    return this.descriptors.filter((descriptor) => event instanceof descriptor.eventType);
  }

  private createInvocationTasks(
    descriptors: EventHandlerDescriptor[],
    event: object,
    publishOptions: ResolvedPublishOptions,
  ): Promise<void>[] {
    return descriptors.map((descriptor) => {
      const isolatedEvent = createIsolatedEvent(descriptor.eventType, event);
      return this.invokeHandlerWithBounds(descriptor, isolatedEvent, publishOptions);
    });
  }

  private createBackgroundInvocationTasks(
    descriptors: EventHandlerDescriptor[],
    event: object,
    signal: AbortSignal | undefined,
  ): Promise<void>[] {
    return descriptors.map((descriptor) => {
      const isolatedEvent = createIsolatedEvent(descriptor.eventType, event);
      return this.invokeHandlerInBackground(descriptor, isolatedEvent, signal);
    });
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

  private channelFromEventType(eventType: EventType): string {
    if (typeof eventType.eventKey === 'string') {
      const eventKey = eventType.eventKey.trim();

      if (eventKey.length > 0) {
        return eventKey;
      }
    }

    return eventType.name;
  }

  private channelsForTransportPublish(event: object, descriptors: EventHandlerDescriptor[]): string[] {
    const channels = new Set<string>();

    for (const descriptor of descriptors) {
      channels.add(this.channelFromEventType(descriptor.eventType));
    }

    if (channels.size === 0) {
      channels.add(this.channelFromEventType(event.constructor as EventType));
    }

    return Array.from(channels);
  }

  private async publishToTransport(event: object, descriptors: EventHandlerDescriptor[]): Promise<void> {
    if (!this.transport) {
      return;
    }

    const channels = this.channelsForTransportPublish(event, descriptors);

    const publishTasks = channels.map(async (channel) => {
      const payload = createIsolatedEvent(event.constructor as EventType, event);

      try {
        await this.transport!.publish(channel, payload);
      } catch (error) {
        this.transportPublishFailures += 1;
        this.logger.error(
          `EventBusTransport failed to publish to channel "${channel}".`,
          error,
          'EventBusLifecycleService',
        );
      }
    });

    await Promise.allSettled(publishTasks);
  }

  private async subscribeTransportChannels(): Promise<void> {
    if (!this.transport) {
      return;
    }

    const descriptorsByChannel = new Map<string, EventHandlerDescriptor[]>();

    for (const descriptor of this.descriptors) {
      const channel = this.channelFromEventType(descriptor.eventType);
      const channelDescriptors = descriptorsByChannel.get(channel) ?? [];
      channelDescriptors.push(descriptor);
      descriptorsByChannel.set(channel, channelDescriptors);
    }

    for (const [channel, channelDescriptors] of descriptorsByChannel) {
      await this.subscribeTransportChannel(channel, channelDescriptors);
    }
  }

  private async subscribeTransportChannel(
    channel: string,
    channelDescriptors: EventHandlerDescriptor[],
  ): Promise<void> {
    try {
      await this.transport!.subscribe(channel, async (payload) => {
        if (channelDescriptors.length === 0) {
          return;
        }

        const invocationTasks = channelDescriptors.map((descriptor) =>
          this.invokeHandlerWithBounds(
            descriptor,
            createIsolatedEvent(descriptor.eventType, payload),
            {
              signal: undefined,
              timeoutMs: this.normalizeTimeoutMs(this.moduleOptions.publish?.timeoutMs),
              waitForHandlers: this.moduleOptions.publish?.waitForHandlers ?? true,
            },
          ),
        );

        await Promise.allSettled(invocationTasks);
      });
      this.subscribedChannels.add(channel);
    } catch (error) {
      this.transportSubscribeFailures += 1;
      this.logger.error(
        `EventBusTransport failed to subscribe to channel "${channel}".`,
        error,
        'EventBusLifecycleService',
      );

      throw error;
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
