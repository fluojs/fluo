import { Inject, type MetadataPropertyKey, type Token } from '@fluojs/core';
import { cloneWithFallback } from '@fluojs/core/internal';
import type { Container, NormalizedProvider } from '@fluojs/di';
import type {
  ApplicationLogger,
  CompiledModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@fluojs/runtime';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
} from '@fluojs/runtime/internal';

import { getEventHandlerMetadataEntries } from './metadata.js';
import type {
  EventBusWithResults,
  EventDeliveryOutcome,
  EventDeliveryStatus,
  EventPublishResult,
  EventPublishSettlement,
} from './publish-result.js';
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
  reportResults?: boolean;
  signal: AbortSignal | undefined;
  timeoutMs: number | undefined;
  waitForHandlers: boolean;
}

interface InvocationBound {
  cleanup(): void;
  promise: Promise<never>;
}

const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

function createIsolatedEvent<TEvent extends object>(eventType: EventType<TEvent>, source: unknown): TEvent {
  const clonedPayload = cloneWithFallback(source);

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

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function hasEventHandlerMetadata(targetType: Function): boolean {
  return getEventHandlerMetadataEntries(targetType.prototype).length > 0;
}

/**
 * Lifecycle-managed in-process event bus with optional external transport fan-out.
 *
 * The service discovers `@OnEvent()` handlers, clones payloads before dispatch,
 * and can publish the same events to an external transport such as Redis Pub/Sub.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, EVENT_BUS_OPTIONS)
export class EventBusLifecycleService implements EventBus, EventBusWithResults, OnApplicationBootstrap, OnApplicationShutdown {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private readonly handlerInstances = new Map<Token, Promise<unknown>>();
  private readonly subscribedChannels = new Set<string>();
  private transportCloseFailures = 0;
  private transportPublishFailures = 0;
  private transportSubscribeFailures = 0;
  private shutdownDrainTimeouts = 0;
  private readonly activeDispatches = new Set<Promise<void>>();
  private readonly transport: EventBusTransport | undefined;
  private transportClosed = false;
  private shutdownDeadlineAtMs: number | undefined;

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

    if (this.activeDispatches.size > 0) {
      await this.drainActiveDispatches();
    }

    if (this.transport) {
      await this.closeTransportOrRecordFailure('EventBusTransport failed to close.');
    }

    this.lifecycleState = 'stopped';
  }

  /**
   * Creates a platform status snapshot for health checks and diagnostics.
   *
   * @returns A structured snapshot describing discovery state, transport wiring, and failure counters.
   */
  createPlatformStatusSnapshot() {
    return createEventBusPlatformStatusSnapshot({
      handlersDiscovered: this.descriptors.length,
      lifecycleState: this.lifecycleState,
      shutdownDrainTimeoutMs: this.resolveShutdownDrainTimeoutMs(),
      shutdownDrainTimeouts: this.shutdownDrainTimeouts,
      subscribedChannels: this.subscribedChannels.size,
      transportCloseFailures: this.transportCloseFailures,
      transportConfigured: this.transport !== undefined,
      transportPublishFailures: this.transportPublishFailures,
      transportSubscribeFailures: this.transportSubscribeFailures,
      waitForHandlersDefault: this.moduleOptions.publish?.waitForHandlers ?? true,
    });
  }

  /**
   * Publishes one event to matching local handlers and, when configured, to the external transport.
   *
   * @param event Event instance to publish.
   * @param options Optional bounds for matching local handlers and transport publication.
   * @returns A promise that resolves after publication attempts settle, or after background work is scheduled when
   * `waitForHandlers` is `false`. Handler and transport failures are recorded without rejecting the caller.
   */
  async publish(event: object, options?: EventPublishOptions): Promise<void> {
    if (!this.canPublishInCurrentLifecycle()) {
      this.logger.warn(
        `EventBus.publish() was ignored because the event bus is ${this.lifecycleState}.`,
        'EventBusLifecycleService',
      );
      return;
    }

    await this.trackActiveDispatch(this.executePublish(event, options));
  }

  /**
   * Publishes with payload-free observations of local handlers and outbound transport channels.
   *
   * @param event Event instance to publish using the existing discovery and payload-isolation rules.
   * @param options Publish bounds; background receipts observe actual settlement without timeout bounds.
   * @returns Per-recipient outcomes, lifecycle refusal, or a background completion receipt.
   * @remarks Timeout and cancellation do not terminate started work. Discovery and preparation errors reject.
   * Transport success is not a remote delivery acknowledgement. Raw handler/transport errors are omitted from logs.
   */
  async publishWithResult(event: object, options?: EventPublishOptions): Promise<EventPublishResult> {
    switch (this.lifecycleState) {
      case 'failed':
      case 'stopped':
      case 'stopping':
        this.logger.warn(
          `EventBus.publishWithResult() was ignored because the event bus is ${this.lifecycleState}.`,
          'EventBusLifecycleService',
        );
        return { status: 'rejected', reason: this.lifecycleState };
      case 'created':
      case 'discovering':
      case 'ready':
        return await this.trackActiveDispatchWork(this.executePublishWithResult(event, options));
    }
  }

  /**
   * Caps this event bus shutdown drain at a deadline coordinated by an owning integration.
   *
   * @internal
   * @param deadlineAtMs Absolute timestamp in milliseconds.
   */
  adoptShutdownDeadline(deadlineAtMs: number): void {
    this.shutdownDeadlineAtMs = Math.min(this.shutdownDeadlineAtMs ?? deadlineAtMs, deadlineAtMs);
  }

  private async executePublish(event: object, options?: EventPublishOptions): Promise<void> {
    await this.ensureDiscovered();
    const matchingDescriptors = this.matchEventDescriptors(event);
    const publishOptions = this.resolvePublishOptions(options);

    const transportPayload = createIsolatedEvent(event.constructor as EventType, event);

    if (!publishOptions.waitForHandlers) {
      const transportPublish = this.publishToTransport(transportPayload, matchingDescriptors, {
        ...publishOptions,
        timeoutMs: undefined,
      });
      const backgroundTasks = this.createBackgroundInvocationTasks(matchingDescriptors, event, publishOptions.signal);
      this.runInvocationTasksInBackground([...backgroundTasks, transportPublish]);

      return;
    }

    const transportPublish = this.publishToTransport(transportPayload, matchingDescriptors, publishOptions);

    if (matchingDescriptors.length === 0) {
      await transportPublish;

      return;
    }

    const invocationTasks = this.createInvocationTasks(matchingDescriptors, event, publishOptions);

    await Promise.allSettled([...invocationTasks, transportPublish]);
  }

  private canPublishInCurrentLifecycle(): boolean {
    return !['failed', 'stopped', 'stopping'].includes(this.lifecycleState);
  }

  private async executePublishWithResult(event: object, options?: EventPublishOptions): Promise<EventPublishResult> {
    await this.ensureDiscovered();
    const descriptors = this.matchEventDescriptors(event);
    const resolved = this.resolvePublishOptions(options);
    const publishOptions = {
      ...resolved,
      reportResults: true,
      timeoutMs: resolved.waitForHandlers ? resolved.timeoutMs : undefined,
    };
    const transportPayload = createIsolatedEvent(event.constructor as EventType, event);
    const localPayloads = descriptors.map((descriptor) => createIsolatedEvent(descriptor.eventType, event));
    const transportTasks = this.createTransportPublishTasks(transportPayload, descriptors, publishOptions);
    const handlerTasks = descriptors.map(async (descriptor, index): Promise<EventDeliveryOutcome> => ({
      target: {
        kind: 'handler',
        index,
        moduleName: descriptor.moduleName,
        targetName: descriptor.targetName,
        methodName: descriptor.methodName,
      },
      ...await this.invokeHandlerWithResult(descriptor, localPayloads[index], publishOptions),
    }));
    const completion = Promise.all([...handlerTasks, ...transportTasks]).then(
      (outcomes): EventPublishSettlement => outcomes.length === 0
        ? { status: 'no-recipients', outcomes: [] }
        : { status: 'settled', outcomes },
    );

    if (!resolved.waitForHandlers) {
      return { status: 'background', completion: this.trackActiveDispatchWork(completion) };
    }

    return await completion;
  }

  private async invokeHandlerWithResult(
    descriptor: EventHandlerDescriptor,
    event: object,
    options: ResolvedPublishOptions,
  ): Promise<EventDeliveryStatus> {
    if (options.signal?.aborted) {
      this.logPublishCancelledBeforeDispatch(descriptor);
      return { status: 'cancelled', started: false };
    }

    const invocation = this.trackActiveDispatchWork(this.invokeHandler(descriptor, event, true));
    try {
      return options.waitForHandlers ? await this.awaitInvocationBounds(invocation, options) : await invocation;
    } catch (error) {
      this.logBoundedInvocationError(descriptor, error, true);
      return this.deliveryFailure(error, 'handler');
    }
  }

  private deliveryFailure(error: unknown, reason: 'handler' | 'transport'): EventDeliveryStatus {
    if (error instanceof EventPublishTimeoutError) {
      return { status: 'timed-out', timeoutMs: error.timeoutMs };
    }
    if (error instanceof EventPublishAbortError) {
      return { status: 'cancelled', started: true };
    }
    return { status: 'failed', reason };
  }

  private async drainActiveDispatches(): Promise<void> {
    const timeoutMs = this.resolveShutdownDrainTimeoutMs();
    const drained = await this.awaitShutdownDrain(timeoutMs);

    if (!drained) {
      this.shutdownDrainTimeouts += 1;
      this.logger.warn(
        `Event bus shutdown drain exceeded ${String(timeoutMs)}ms with ${String(this.activeDispatches.size)} active dispatch workflow(s); continuing shutdown.`,
        'EventBusLifecycleService',
      );
    }
  }

  private async trackActiveDispatch(dispatchWorkflow: Promise<void>): Promise<void> {
    this.activeDispatches.add(dispatchWorkflow);

    try {
      await dispatchWorkflow;
    } finally {
      this.activeDispatches.delete(dispatchWorkflow);
    }
  }

  private trackActiveDispatchWork<T>(dispatchWork: Promise<T>): Promise<T> {
    const trackedWork = dispatchWork.then(
      () => undefined,
      () => undefined,
    );
    this.activeDispatches.add(trackedWork);
    void trackedWork.finally(() => {
      this.activeDispatches.delete(trackedWork);
    });

    return dispatchWork;
  }

  private async awaitShutdownDrain(timeoutMs: number): Promise<boolean> {
    if (timeoutMs <= 0) {
      return false;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
      while (this.activeDispatches.size > 0) {
        const activeDispatches = Array.from(this.activeDispatches);
        const drained = await Promise.race([Promise.allSettled(activeDispatches).then(() => true), timeout]);

        if (!drained) {
          return false;
        }
      }

      return true;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private resolveShutdownDrainTimeoutMs(): number {
    const timeoutMs =
      this.normalizeTimeoutMs(this.moduleOptions.shutdown?.drainTimeoutMs) ?? DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
    const remainingTimeoutMs =
      this.shutdownDeadlineAtMs === undefined ? undefined : Math.max(0, this.shutdownDeadlineAtMs - Date.now());

    return remainingTimeoutMs === undefined ? timeoutMs : Math.min(timeoutMs, remainingTimeoutMs);
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
      void this.trackActiveDispatchWork(task);
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
      this.descriptors = await this.discoverHandlerDescriptors();
      this.handlerInstances.clear();
      await this.preloadHandlerInstances(this.descriptors);
      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private channelFromEventType(eventType: EventType): string {
    if (Object.hasOwn(eventType, 'eventKey') && typeof eventType.eventKey === 'string') {
      const eventKey = eventType.eventKey.trim();

      if (eventKey.length > 0) {
        return eventKey;
      }
    }

    return eventType.name;
  }

  private channelsForTransportPublish(event: object, descriptors: EventHandlerDescriptor[]): string[] {
    const channels = new Set<string>();

    for (const eventType of this.eventTypeLineage(event)) {
      channels.add(this.channelFromEventType(eventType));
    }

    for (const descriptor of descriptors) {
      channels.add(this.channelFromEventType(descriptor.eventType));
    }

    if (channels.size === 0) {
      channels.add(this.channelFromEventType(event.constructor as EventType));
    }

    return Array.from(channels);
  }

  private eventTypeLineage(event: object): EventType[] {
    const eventTypes: EventType[] = [];
    let prototype = Object.getPrototypeOf(event) as object | null;

    while (prototype && prototype !== Object.prototype) {
      const constructor = prototype.constructor;

      if (typeof constructor === 'function') {
        eventTypes.push(constructor as EventType);
      }

      prototype = Object.getPrototypeOf(prototype) as object | null;
    }

    return eventTypes;
  }

  private async publishToTransport(
    event: object,
    descriptors: EventHandlerDescriptor[],
    publishOptions: ResolvedPublishOptions,
  ): Promise<void> {
    await Promise.allSettled(this.createTransportPublishTasks(event, descriptors, publishOptions));
  }

  private createTransportPublishTasks(
    event: object,
    descriptors: EventHandlerDescriptor[],
    publishOptions: ResolvedPublishOptions,
  ): Promise<EventDeliveryOutcome>[] {
    const transport = this.transport;
    if (!transport) {
      return [];
    }
    const channels = this.channelsForTransportPublish(event, descriptors);

    return channels.map(async (channel): Promise<EventDeliveryOutcome> => {
      const target = { kind: 'transport', channel } as const;
      const payload = createIsolatedEvent(event.constructor as EventType, event);

      if (publishOptions.signal?.aborted) {
        this.logTransportPublishCancelledBeforeDispatch(channel);
        return { target, status: 'cancelled', started: false };
      }

      try {
        const publishWork = transport.publish(channel, payload);
        const trackedPublishWork = this.trackActiveDispatchWork(publishWork);
        if (publishOptions.reportResults && !publishOptions.waitForHandlers) {
          await trackedPublishWork;
        } else {
          await this.awaitInvocationBounds(trackedPublishWork, publishOptions);
        }
        return { target, status: 'succeeded' };
      } catch (error) {
        this.transportPublishFailures += 1;
        this.logBoundedTransportPublishError(channel, error, publishOptions.reportResults);
        return { target, ...this.deliveryFailure(error, 'transport') };
      }
    });
  }

  private logTransportPublishCancelledBeforeDispatch(channel: string): void {
    this.logger.warn(
      `Event publish was cancelled before publishing transport channel "${channel}".`,
      'EventBusLifecycleService',
    );
  }

  private logBoundedTransportPublishError(channel: string, error: unknown, redactError = false): void {
    if (error instanceof EventPublishTimeoutError) {
      this.logger.warn(
        `EventBusTransport publish to channel "${channel}" exceeded publish timeout of ${String(error.timeoutMs)}ms.`,
        'EventBusLifecycleService',
      );
      return;
    }

    if (error instanceof EventPublishAbortError) {
      this.logger.warn(
        `Event publish was cancelled while waiting for transport channel "${channel}".`,
        'EventBusLifecycleService',
      );
      return;
    }

    this.logger.error(
      `EventBusTransport failed to publish to channel "${channel}".`,
      redactError ? undefined : error,
      'EventBusLifecycleService',
    );
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

    try {
      for (const [channel, channelDescriptors] of descriptorsByChannel) {
        await this.subscribeTransportChannel(channel, channelDescriptors);
      }
    } catch (error) {
      await this.rollbackTransportSubscriptionsAfterBootstrapFailure();
      throw error;
    }
  }

  private async rollbackTransportSubscriptionsAfterBootstrapFailure(): Promise<void> {
    try {
      await this.closeTransportOrRecordFailure('EventBusTransport failed to close after bootstrap subscription failure.');
    } catch {
      // Preserve the original subscription failure while runtime cleanup retries this incomplete close.
    }
  }

  private async closeTransportOrRecordFailure(message: string): Promise<void> {
    try {
      await this.closeTransport();
    } catch (error) {
      this.transportCloseFailures += 1;
      this.lifecycleState = 'failed';
      this.logger.error(message, error, 'EventBusLifecycleService');

      throw error;
    }
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport;

    if (!transport || this.transportClosed) {
      return;
    }

    await transport.close();
    this.transportClosed = true;
    this.subscribedChannels.clear();
  }

  private async subscribeTransportChannel(
    channel: string,
    channelDescriptors: EventHandlerDescriptor[],
  ): Promise<void> {
    try {
      await this.transport!.subscribe(channel, async (payload) => {
        if (!this.canDispatchIncomingTransportMessage()) {
          this.logger.warn(
            `EventBusTransport message on channel "${channel}" was ignored because the event bus is ${this.lifecycleState}.`,
            'EventBusLifecycleService',
          );
          return;
        }

        if (channelDescriptors.length === 0) {
          return;
        }

        await this.trackActiveDispatch(this.dispatchIncomingTransportMessage(channelDescriptors, payload));
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

  private canDispatchIncomingTransportMessage(): boolean {
    return this.lifecycleState === 'ready';
  }

  private async dispatchIncomingTransportMessage(
    channelDescriptors: EventHandlerDescriptor[],
    payload: unknown,
  ): Promise<void> {
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

    const invocation = this.trackActiveDispatchWork(this.invokeHandler(descriptor, event));

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

  private logBoundedInvocationError(descriptor: EventHandlerDescriptor, error: unknown, redactError = false): void {
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
      redactError ? undefined : error,
      'EventBusLifecycleService',
    );
  }

  private async awaitInvocationBounds<T>(
    invocation: Promise<T>,
    publishOptions: ResolvedPublishOptions,
  ): Promise<T> {
    const timeoutMs = publishOptions.timeoutMs;
    const signal = publishOptions.signal;

    if (timeoutMs === undefined && !signal) {
      return await invocation;
    }

    const bounds = this.createInvocationBounds(timeoutMs, signal);

    try {
      return await Promise.race([invocation, ...bounds.map((bound) => bound.promise)]);
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
    if (signal?.aborted) {
      throw new EventPublishAbortError();
    }

    const bounds: InvocationBound[] = [];

    if (timeoutMs !== undefined) {
      bounds.push(this.createTimeoutBound(timeoutMs));
    }

    if (signal) {
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

  private async discoverHandlerDescriptors(): Promise<EventHandlerDescriptor[]> {
    const seen = new Map<Token, Map<MetadataPropertyKey, Set<EventType>>>();
    const descriptors: EventHandlerDescriptor[] = [];

    for (const candidate of await this.discoveryCandidates()) {
      const entries = getEventHandlerMetadataEntries(candidate.targetType.prototype);

      if (this.shouldSkipNonSingletonCandidate(candidate, entries.length)) {
        continue;
      }

      for (const entry of entries) {
        const eventType = entry.metadata.eventType;

        if (this.isDuplicateHandlerRegistration(seen, candidate.token, entry.propertyKey, eventType)) {
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
    seen: Map<Token, Map<MetadataPropertyKey, Set<EventType>>>,
    token: Token,
    methodKey: MetadataPropertyKey,
    eventType: EventType,
  ): boolean {
    let methodsByKey = seen.get(token);

    if (!methodsByKey) {
      methodsByKey = new Map<MetadataPropertyKey, Set<EventType>>();
      seen.set(token, methodsByKey);
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

  private async discoveryCandidates(): Promise<DiscoveryCandidate[]> {
    const candidates: DiscoveryCandidate[] = [];
    const moduleNames = new Map<Token, string>();
    const registrations = this.runtimeContainer.inspectResolutionState().registrations;

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        const token = typeof provider === 'function' ? provider : provider.provide;
        moduleNames.set(token, compiledModule.type.name);
      }

      for (const controller of compiledModule.definition.controllers ?? []) {
        moduleNames.set(controller, compiledModule.type.name);
      }
    }

    for (const [token, provider] of registrations) {
      const resolvedCandidate = this.resolveProviderDiscoveryCandidate(
        moduleNames.get(token) ?? 'BootstrapProviders',
        provider,
      );

      if (resolvedCandidate) {
        candidates.push(resolvedCandidate);
      }
    }

    return candidates;
  }

  private resolveProviderDiscoveryCandidate(
    moduleName: string,
    provider: NormalizedProvider,
  ): DiscoveryCandidate | undefined {
    const scope = provider.scope;
    const token = provider.provide;

    if (scope !== 'singleton') {
      return this.createUnresolvedProviderDiscoveryCandidate(moduleName, provider);
    }

    if (provider.type === 'value') {
      const instance = provider.useValue;

      if (typeof instance !== 'object' || instance === null) {
        return undefined;
      }

      const targetType = instance.constructor;

      if (typeof targetType !== 'function' || !hasEventHandlerMetadata(targetType)) {
        return undefined;
      }

      return {
        moduleName,
        scope,
        targetType,
        token,
      };
    }

    const targetType = provider.type === 'class'
      ? provider.useClass
      : typeof token === 'function'
        ? token
        : undefined;

    if (!targetType || !hasEventHandlerMetadata(targetType)) {
      return undefined;
    }

    return {
      moduleName,
      scope,
      targetType,
      token,
    };
  }

  private createUnresolvedProviderDiscoveryCandidate(
    moduleName: string,
    provider: NormalizedProvider,
  ): DiscoveryCandidate | undefined {
    const targetType = provider.type === 'class'
      ? provider.useClass
      : typeof provider.provide === 'function'
        ? provider.provide
        : undefined;

    if (!targetType) {
      return undefined;
    }

    return {
      moduleName,
      scope: provider.scope,
      targetType,
      token: provider.provide,
    };
  }

  private async invokeHandler(
    descriptor: EventHandlerDescriptor,
    event: object,
    redactError = false,
  ): Promise<EventDeliveryStatus> {
    const instance = await this.resolveHandlerInstance(descriptor);

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'EventBusLifecycleService',
      );
      return { status: 'failed', reason: 'not-callable' };
    }

    try {
      await Promise.resolve((value as (this: unknown, event: object) => Promise<void>).call(instance, event));
      return { status: 'succeeded' };
    } catch (error) {
      this.logger.error(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} failed.`,
        redactError ? undefined : error,
        'EventBusLifecycleService',
      );
      return { status: 'failed', reason: 'handler' };
    }
  }

  private async resolveHandlerInstance(descriptor: EventHandlerDescriptor): Promise<unknown> {
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
      throw error;
    }
  }
}
