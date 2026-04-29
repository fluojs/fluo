import { Inject } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import type {
  BunServerWebSocket,
  BunWebSocketBinding,
  BunWebSocketBindingHost,
  BunWebSocketMessage,
  BunServerLike,
} from './bun-types.js';
import type { HttpApplicationAdapter } from '@fluojs/http';

import {
  dispatchGatewayDisconnect,
  dispatchGatewayMessage,
  discoverGatewayDescriptors,
  isFinitePositiveInteger,
  normalizeGatewayPath,
  resolveGatewayInstance,
  runGatewayHandlers,
  type ResolvedGatewayInstance,
} from '../internal/shared.js';
import { WEBSOCKET_OPTIONS_INTERNAL } from '../options-token.internal.js';
import type {
  WebSocketGatewayDescriptor,
  WebSocketUpgradeRejection,
  WebSocketRoomService,
} from '../types.js';
import type { WebSocketModuleOptions } from './bun-types.js';

interface BufferedDisconnectEvent {
  code: number;
  reason: string;
}

interface ConnectionHandlerState {
  bufferedDisconnect: BufferedDisconnectEvent | undefined;
  bufferedMessages: BunWebSocketMessage[];
  bufferedMessagesStartIndex: number;
  connectLifecycleSettled: boolean;
  connectLifecyclePromise: Promise<void>;
  descriptors: readonly WebSocketGatewayDescriptor[];
  disconnectLifecycleSettled: boolean;
  disconnectLifecyclePromise: Promise<void>;
  enqueuedMessageCount: number;
  handlerQueue: Promise<void>;
  handlersReady: boolean;
  processingMessageQueue: boolean;
    queuedMessages: BunWebSocketMessage[];
    queuedMessagesStartIndex: number;
    request: Request;
    resolveConnectLifecycle: () => void;
    resolveDisconnectLifecycle: () => void;
    resolved: ResolvedGatewayInstance[];
    socketId: string;
}

interface BunSocketData {
  state: ConnectionHandlerState;
}

const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 256;
const DEFAULT_MAX_WEBSOCKET_CONNECTIONS = 1_000;
const DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES = 1_048_576;
const DEFAULT_WEBSOCKET_SHUTDOWN_TIMEOUT_MS = 5_000;
const LIFECYCLE_LOG_CONTEXT = 'WebSocketGatewayLifecycleService';

type FetchStyleRealtimeCapability = {
  contract: 'raw-websocket-expansion';
  kind: 'fetch-style';
  mode?: 'request-upgrade';
  reason: string;
  support?: 'contract-only' | 'supported';
  version?: 1;
};

type RealtimeCapability =
  | FetchStyleRealtimeCapability
  | {
      kind: 'server-backed';
      reason?: string;
    }
  | {
      kind: 'unsupported';
      mode?: 'no-op';
      reason: string;
    };

type RealtimeAwareHttpApplicationAdapter = HttpApplicationAdapter & {
  getRealtimeCapability?: () => RealtimeCapability;
};

function hasBunWebSocketBindingHost(
  adapter: HttpApplicationAdapter,
): adapter is RealtimeAwareHttpApplicationAdapter & BunWebSocketBindingHost {
  return 'configureWebSocketBinding' in adapter && typeof adapter.configureWebSocketBinding === 'function';
}

function resolveSupportedFetchStyleRealtimeCapability(
  adapter: RealtimeAwareHttpApplicationAdapter,
): FetchStyleRealtimeCapability {
  if (typeof adapter.getRealtimeCapability !== 'function') {
    throw new Error(
      'Bun WebSocket gateway bootstrap requires an HTTP adapter with getRealtimeCapability(). Use @fluojs/platform-bun together with @fluojs/websockets/bun.',
    );
  }

  const capability = adapter.getRealtimeCapability();

  if (capability.kind !== 'fetch-style' || capability.contract !== 'raw-websocket-expansion') {
    throw new Error(
      'Bun WebSocket gateway bootstrap requires a fetch-style raw-websocket-expansion realtime capability from the selected HTTP adapter.',
    );
  }

  if (capability.support !== 'supported') {
    throw new Error(
      `Bun WebSocket gateway bootstrap requires supported fetch-style websocket hosting. ${capability.reason}`,
    );
  }

  return capability;
}

function isHttpExceptionLike(error: unknown): error is { message: string; status: number } {
  return typeof error === 'object' && error !== null && 'message' in error && 'status' in error;
}

function resolveMessageByteLength(message: BunWebSocketMessage): number {
  if (typeof message === 'string') {
    return Buffer.byteLength(message);
  }

  return message.byteLength;
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function createCompletionSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/**
 * Boots Bun-backed websocket gateways and manages their room lifecycle state.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, WEBSOCKET_OPTIONS_INTERNAL)
export class BunWebSocketGatewayLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, WebSocketRoomService
{
  private pendingUpgradeReservations = 0;
  private readonly roomSockets = new Map<string, Set<string>>();
  private shutdownPromise: Promise<void> | undefined;
  private readonly socketRegistry = new Map<string, BunServerWebSocket<BunSocketData>>();
  private readonly socketRooms = new Map<string, Set<string>>();
  private readonly socketStates = new Map<string, ConnectionHandlerState>();

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly adapter: HttpApplicationAdapter,
    private readonly moduleOptions: WebSocketModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const descriptors = discoverGatewayDescriptors(this.compiledModules, this.logger, LIFECYCLE_LOG_CONTEXT);

    if (descriptors.length === 0) {
      return;
    }

    this.assertNoServerBackedGatewayOptIn(descriptors);

    resolveSupportedFetchStyleRealtimeCapability(this.adapter);

    if (!hasBunWebSocketBindingHost(this.adapter)) {
      throw new Error(
        'Bun WebSocket gateway bootstrap requires the selected adapter to expose Bun websocket binding configuration. Use @fluojs/platform-bun with @fluojs/websockets/bun.',
      );
    }

    const bunAdapter = this.adapter as HttpApplicationAdapter & BunWebSocketBindingHost;
    bunAdapter.configureWebSocketBinding(this.createBinding(descriptors));
  }

  private assertNoServerBackedGatewayOptIn(
    descriptors: readonly WebSocketGatewayDescriptor[],
  ): void {
    const descriptor = descriptors.find((entry) => entry.serverBacked !== undefined);

    if (!descriptor) {
      return;
    }

    throw new Error(
      `@WebSocketGateway({ serverBacked }) is not supported on @fluojs/websockets/bun. Gateway path ${descriptor.path} must use the default fetch-style request-upgrade host instead.`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private createBinding(descriptors: readonly WebSocketGatewayDescriptor[]): BunWebSocketBinding<BunSocketData> {
    const descriptorsByPath = this.groupDescriptorsByPath(descriptors);

    return {
      fetch: (request, server) => this.handleUpgradeRequest(request, server, descriptorsByPath),
      websocket: {
        backpressureLimit: this.resolveBackpressureLimit(),
        close: (socket, code, reason) => {
          this.unregisterSocket(socket.data.state.socketId);
          this.handleSocketClose(socket, code, reason);
        },
        closeOnBackpressureLimit: this.moduleOptions.backpressure?.policy === 'close',
        error: (socket, error) => {
          this.unregisterSocket(socket.data.state.socketId);
          this.logger.error('WebSocket gateway socket emitted an error.', error, LIFECYCLE_LOG_CONTEXT);
        },
        idleTimeout: this.resolveIdleTimeoutSeconds(),
        maxPayloadLength: this.resolveMaxPayloadBytes(),
        message: (socket, message) => {
          this.handleSocketMessage(socket, message);
        },
        open: (socket) => {
          void this.bindConnectionHandlers(socket).catch((error) => {
            this.unregisterSocket(socket.data.state.socketId);
            this.logger.error('WebSocket gateway open lifecycle failed.', error, LIFECYCLE_LOG_CONTEXT);
            socket.close(1011, 'Internal server error');
          });
        },
        sendPings: this.moduleOptions.heartbeat?.enabled !== false,
      },
    };
  }

  private groupDescriptorsByPath(
    descriptors: readonly WebSocketGatewayDescriptor[],
  ): Map<string, WebSocketGatewayDescriptor[]> {
    const descriptorsByPath = new Map<string, WebSocketGatewayDescriptor[]>();

    for (const descriptor of descriptors) {
      const current = descriptorsByPath.get(descriptor.path);

      if (current) {
        current.push(descriptor);
        continue;
      }

      descriptorsByPath.set(descriptor.path, [descriptor]);
    }

    return descriptorsByPath;
  }

  private async handleUpgradeRequest(
    request: Request,
    server: BunServerLike,
    descriptorsByPath: ReadonlyMap<string, readonly WebSocketGatewayDescriptor[]>,
  ): Promise<Response | undefined> {
    let targetPath: string;

    try {
      targetPath = normalizeGatewayPath(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }

    const descriptors = descriptorsByPath.get(targetPath);

    if (!descriptors) {
      return undefined;
    }

    if (!isWebSocketUpgradeRequest(request)) {
      return new Response(null, { status: 426 });
    }

    const rejection = await this.resolveUpgradeRejection(request, targetPath);

    if (rejection) {
      return new Response(rejection.body ?? null, {
        headers: rejection.headers,
        status: rejection.status,
      });
    }

    const state = this.createConnectionHandlerState(request, [...descriptors]);
    let upgraded = false;

    try {
      upgraded = server.upgrade(request, { data: { state } });
    } catch (error) {
      this.releaseUpgradeReservation();
      throw error;
    }

    if (!upgraded) {
      this.releaseUpgradeReservation();
      return new Response(null, { status: 400 });
    }

    return undefined;
  }

  private async bindConnectionHandlers(socket: BunServerWebSocket<BunSocketData>): Promise<void> {
    const { state } = socket.data;

    this.releaseUpgradeReservation();
    this.socketRegistry.set(state.socketId, socket);
    this.socketStates.set(state.socketId, state);

    try {
      await this.resolveConnectionGateways(state);
      await this.runConnectHandlers(state, socket);
      await this.finalizeConnectionBinding(state, socket);
    } finally {
      if (!state.handlersReady && state.bufferedDisconnect) {
        this.settleDisconnectLifecycle(state);
      }

      this.settleConnectLifecycle(state);
    }
  }

  private createConnectionHandlerState(
    request: Request,
    descriptors: readonly WebSocketGatewayDescriptor[],
  ): ConnectionHandlerState {
    const connectLifecycle = createCompletionSignal();
    const disconnectLifecycle = createCompletionSignal();

    return {
      bufferedDisconnect: undefined,
      bufferedMessages: [],
      bufferedMessagesStartIndex: 0,
      connectLifecycleSettled: false,
      connectLifecyclePromise: connectLifecycle.promise,
      descriptors,
      disconnectLifecycleSettled: false,
      disconnectLifecyclePromise: disconnectLifecycle.promise,
      enqueuedMessageCount: 0,
      handlerQueue: Promise.resolve(),
      handlersReady: false,
      processingMessageQueue: false,
      queuedMessages: [],
      queuedMessagesStartIndex: 0,
      request,
      resolveConnectLifecycle: connectLifecycle.resolve,
      resolveDisconnectLifecycle: disconnectLifecycle.resolve,
      resolved: [],
      socketId: crypto.randomUUID(),
    };
  }

  private settleConnectLifecycle(state: ConnectionHandlerState): void {
    if (state.connectLifecycleSettled) {
      return;
    }

    state.connectLifecycleSettled = true;
    state.resolveConnectLifecycle();
  }

  private settleDisconnectLifecycle(state: ConnectionHandlerState): void {
    if (state.disconnectLifecycleSettled) {
      return;
    }

    state.disconnectLifecycleSettled = true;
    state.resolveDisconnectLifecycle();
  }

  private getBufferedMessageCount(state: ConnectionHandlerState): number {
    return state.bufferedMessages.length - state.bufferedMessagesStartIndex;
  }

  private getQueuedMessageCount(state: ConnectionHandlerState): number {
    return state.queuedMessages.length - state.queuedMessagesStartIndex;
  }

  private maybeCompactBufferedMessages(state: ConnectionHandlerState): void {
    if (state.bufferedMessagesStartIndex === 0 || state.bufferedMessagesStartIndex < state.bufferedMessages.length / 2) {
      return;
    }

    state.bufferedMessages = state.bufferedMessages.slice(state.bufferedMessagesStartIndex);
    state.bufferedMessagesStartIndex = 0;
  }

  private clearBufferedMessages(state: ConnectionHandlerState): void {
    state.bufferedMessages = [];
    state.bufferedMessagesStartIndex = 0;
  }

  private maybeCompactQueuedMessages(state: ConnectionHandlerState): void {
    if (state.queuedMessagesStartIndex === 0 || state.queuedMessagesStartIndex < state.queuedMessages.length / 2) {
      return;
    }

    state.queuedMessages = state.queuedMessages.slice(state.queuedMessagesStartIndex);
    state.queuedMessagesStartIndex = 0;
  }

  private clearQueuedMessages(state: ConnectionHandlerState): void {
    state.queuedMessages = [];
    state.queuedMessagesStartIndex = 0;
    state.enqueuedMessageCount = 0;
  }

  private handleSocketMessage(socket: BunServerWebSocket<BunSocketData>, message: BunWebSocketMessage): void {
    const { state } = socket.data;

    if (this.closeOversizedPayload(state.socketId, socket, message)) {
      return;
    }

    if (!state.handlersReady) {
      this.bufferIncomingMessage(state, socket, message);
      return;
    }

    this.enqueueMessageDispatch(state, socket, message);
  }

  private handleSocketClose(socket: BunServerWebSocket<BunSocketData>, code: number, reason: string): void {
    const { state } = socket.data;
    const disconnectEvent: BufferedDisconnectEvent = { code, reason };

    if (!state.handlersReady) {
      state.bufferedDisconnect = disconnectEvent;
      return;
    }

    this.enqueueDisconnectDispatch(state, socket, disconnectEvent);
  }

  private bufferIncomingMessage(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
    message: BunWebSocketMessage,
  ): void {
    const limit = isFinitePositiveInteger(this.moduleOptions.buffer?.maxPendingMessagesPerSocket)
      ? this.moduleOptions.buffer.maxPendingMessagesPerSocket
      : DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
    const policy = this.moduleOptions.buffer?.overflowPolicy ?? 'drop-oldest';

    if (this.getBufferedMessageCount(state) < limit) {
      state.bufferedMessages.push(message);
      return;
    }

    if (policy === 'close') {
      socket.close(1013, 'Pending message buffer limit exceeded');
      this.clearBufferedMessages(state);
      this.logger.warn(
        `WebSocket connection ${state.socketId} exceeded pending message buffer limit (${String(limit)}). Connection closed.`,
        LIFECYCLE_LOG_CONTEXT,
      );
      return;
    }

    if (policy === 'drop-newest') {
      this.logger.warn(
        `WebSocket connection ${state.socketId} dropped an incoming message due to pending buffer limit (${String(limit)}).`,
        LIFECYCLE_LOG_CONTEXT,
      );
      return;
    }

    state.bufferedMessagesStartIndex += 1;
    this.maybeCompactBufferedMessages(state);
    state.bufferedMessages.push(message);
    this.logger.warn(
      `WebSocket connection ${state.socketId} dropped the oldest pending message due to buffer limit (${String(limit)}).`,
      LIFECYCLE_LOG_CONTEXT,
    );
  }

  private enqueueMessageDispatch(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
    message: BunWebSocketMessage,
  ): void {
    const limit = isFinitePositiveInteger(this.moduleOptions.buffer?.maxPendingMessagesPerSocket)
      ? this.moduleOptions.buffer.maxPendingMessagesPerSocket
      : DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
    const policy = this.moduleOptions.buffer?.overflowPolicy ?? 'drop-oldest';

    if (this.getQueuedMessageCount(state) >= limit) {
      if (policy === 'close') {
        socket.close(1013, 'Ready-state message queue limit exceeded');
        this.clearQueuedMessages(state);
        this.unregisterSocket(state.socketId);
        this.logger.warn(
          `WebSocket connection ${state.socketId} exceeded ready-state message queue limit (${String(limit)}). Connection closed.`,
          LIFECYCLE_LOG_CONTEXT,
        );
        return;
      }

      if (policy === 'drop-oldest') {
        state.queuedMessagesStartIndex += 1;
        this.maybeCompactQueuedMessages(state);
        this.logger.warn(
          `WebSocket connection ${state.socketId} dropped the oldest ready-state message because queue limit (${String(limit)}) was reached.`,
          LIFECYCLE_LOG_CONTEXT,
        );
      } else {
        this.logger.warn(
          `WebSocket connection ${state.socketId} dropped a ready-state message because queue limit (${String(limit)}) was reached.`,
          LIFECYCLE_LOG_CONTEXT,
        );
        return;
      }
    }

    state.queuedMessages.push(message);
    state.enqueuedMessageCount = this.getQueuedMessageCount(state);

    if (state.processingMessageQueue) {
      return;
    }

    state.processingMessageQueue = true;
    state.handlerQueue = this.drainMessageQueue(state, socket)
      .finally(() => {
        state.processingMessageQueue = false;
        state.enqueuedMessageCount = this.getQueuedMessageCount(state);
      })
      .catch((error) => {
        this.logger.error('WebSocket gateway message dispatch failed.', error, LIFECYCLE_LOG_CONTEXT);
      });
  }

  private async drainMessageQueue(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
  ): Promise<void> {
    while (state.queuedMessagesStartIndex < state.queuedMessages.length) {
      const nextMessage = state.queuedMessages[state.queuedMessagesStartIndex];
      state.queuedMessagesStartIndex += 1;
      state.enqueuedMessageCount = this.getQueuedMessageCount(state);

      if (nextMessage === undefined) {
        continue;
      }

      await dispatchGatewayMessage(state.resolved, socket, state.request, nextMessage, this.logger, LIFECYCLE_LOG_CONTEXT);
    }

    this.clearQueuedMessages(state);
  }

  private enqueueDisconnectDispatch(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
    disconnectEvent: BufferedDisconnectEvent,
  ): void {
    state.handlerQueue = state.handlerQueue
      .then(async () => {
        await dispatchGatewayDisconnect(
          state.resolved,
          socket,
          disconnectEvent.code,
          disconnectEvent.reason,
          state.socketId,
          this.logger,
          LIFECYCLE_LOG_CONTEXT,
        );
      })
      .catch((error) => {
        this.logger.error('WebSocket gateway disconnect dispatch failed.', error, LIFECYCLE_LOG_CONTEXT);
      })
      .finally(() => {
        this.settleDisconnectLifecycle(state);
      });
  }

  private async resolveConnectionGateways(state: ConnectionHandlerState): Promise<void> {
    const resolved: ResolvedGatewayInstance[] = [];

    for (const descriptor of state.descriptors) {
      const instance = await resolveGatewayInstance(this.runtimeContainer, descriptor, this.logger, LIFECYCLE_LOG_CONTEXT);

      if (instance !== undefined) {
        resolved.push({ descriptor, instance });
      }
    }

    state.resolved = resolved;
  }

  private async runConnectHandlers(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
  ): Promise<void> {
    for (const { descriptor, instance } of state.resolved) {
      await runGatewayHandlers(instance, descriptor, 'connect', [socket, state.request, state.socketId], this.logger, LIFECYCLE_LOG_CONTEXT);
    }
  }

  private async finalizeConnectionBinding(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
  ): Promise<void> {
    state.handlersReady = true;
    this.replayBufferedConnectionEvents(state, socket);
    await state.handlerQueue;
  }

  private replayBufferedConnectionEvents(
    state: ConnectionHandlerState,
    socket: BunServerWebSocket<BunSocketData>,
  ): void {
    for (let index = state.bufferedMessagesStartIndex; index < state.bufferedMessages.length; index += 1) {
      const message = state.bufferedMessages[index];

      if (message !== undefined) {
        this.enqueueMessageDispatch(state, socket, message);
      }
    }

    if (state.bufferedDisconnect) {
      this.enqueueDisconnectDispatch(state, socket, state.bufferedDisconnect);
      state.bufferedDisconnect = undefined;
    }

    this.clearBufferedMessages(state);
  }

  private resolveBackpressureLimit(): number {
    const configured = this.moduleOptions.backpressure?.maxBufferedAmountBytes;

    if (!isFinitePositiveInteger(configured)) {
      return 1_048_576;
    }

    return configured;
  }

  private async resolveUpgradeRejection(
    request: Request,
    path: string,
  ): Promise<WebSocketUpgradeRejection | undefined> {
    if (!this.tryReserveUpgradeSlot()) {
      return {
        body: 'WebSocket connection limit exceeded.',
        status: 429,
      };
    }

    const guard = this.moduleOptions.upgrade?.guard;

    if (!guard) {
      return undefined;
    }

    try {
      const result = await guard(request, {
        activeConnectionCount: this.resolveReservedConnectionCount() - 1,
        path,
      });

      if (result === false) {
        this.releaseUpgradeReservation();
        return {
          body: 'WebSocket upgrade rejected.',
          status: 403,
        };
      }

      if (typeof result === 'object' && result !== null && 'status' in result) {
        this.releaseUpgradeReservation();
        return result as WebSocketUpgradeRejection;
      }

      return undefined;
    } catch (error) {
      this.releaseUpgradeReservation();

      if (isHttpExceptionLike(error)) {
        return {
          body: error.message,
          status: error.status,
        };
      }

      throw error;
    }
  }

  private closeOversizedPayload(
    socketId: string,
    socket: BunServerWebSocket<BunSocketData>,
    message: BunWebSocketMessage,
  ): boolean {
    const maxPayloadBytes = this.resolveMaxPayloadBytes();

    if (resolveMessageByteLength(message) <= maxPayloadBytes) {
      return false;
    }

    socket.close(1009, 'Payload too large');
    this.logger.warn(
      `WebSocket connection ${socketId} exceeded payload limit (${String(maxPayloadBytes)} bytes). Connection closed.`,
      LIFECYCLE_LOG_CONTEXT,
    );
    return true;
  }

  private resolveMaxConnectionCount(): number {
    const configured = this.moduleOptions.limits?.maxConnections;

    if (!isFinitePositiveInteger(configured)) {
      return DEFAULT_MAX_WEBSOCKET_CONNECTIONS;
    }

    return configured;
  }

  private resolveReservedConnectionCount(): number {
    return this.socketRegistry.size + this.pendingUpgradeReservations;
  }

  private tryReserveUpgradeSlot(): boolean {
    if (this.resolveReservedConnectionCount() >= this.resolveMaxConnectionCount()) {
      return false;
    }

    this.pendingUpgradeReservations += 1;
    return true;
  }

  private releaseUpgradeReservation(): void {
    if (this.pendingUpgradeReservations > 0) {
      this.pendingUpgradeReservations -= 1;
    }
  }

  private resolveMaxPayloadBytes(): number {
    const configured = this.moduleOptions.limits?.maxPayloadBytes;

    if (!isFinitePositiveInteger(configured)) {
      return DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES;
    }

    return configured;
  }

  private resolveIdleTimeoutSeconds(): number {
    if (this.moduleOptions.heartbeat?.enabled === false) {
      return 0;
    }

    const configured = this.moduleOptions.heartbeat?.timeoutMs;

    if (!isFinitePositiveInteger(configured)) {
      return 120;
    }

    return Math.max(1, Math.ceil(configured / 1000));
  }

  private resolveShutdownTimeoutMs(): number {
    const configured = this.moduleOptions.shutdown?.timeoutMs;

    if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_WEBSOCKET_SHUTDOWN_TIMEOUT_MS;
    }

    return Math.floor(configured);
  }

  private async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.shutdownPromise = this.runShutdownLifecycle();
    await this.shutdownPromise;
  }

  private async runShutdownLifecycle(): Promise<void> {
    if (hasBunWebSocketBindingHost(this.adapter)) {
      const bunAdapter = this.adapter as HttpApplicationAdapter & BunWebSocketBindingHost;
      bunAdapter.configureWebSocketBinding(undefined);
    }

    const shutdownTimeoutMs = this.resolveShutdownTimeoutMs();

    await this.closeActiveSockets(shutdownTimeoutMs);

    this.pendingUpgradeReservations = 0;
    this.socketRegistry.clear();
    this.socketRooms.clear();
    this.socketStates.clear();
    this.roomSockets.clear();
  }

  private async closeActiveSockets(timeoutMs: number): Promise<void> {
    const activeSockets = [...this.socketRegistry.entries()];

    if (activeSockets.length === 0) {
      return;
    }

    const activeStates = activeSockets
      .map(([socketId]) => this.socketStates.get(socketId))
      .filter((state): state is ConnectionHandlerState => state !== undefined);

    for (const [, socket] of activeSockets) {
      if (socket.readyState === 1) {
        socket.close(1001, 'Server shutting down');
      }
    }

    await this.awaitHandlerQueueDrain(activeStates, timeoutMs);
  }

  private async awaitHandlerQueueDrain(
    states: readonly ConnectionHandlerState[],
    timeoutMs: number,
  ): Promise<void> {
    if (states.length === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new Error(`Timed out while closing Bun websocket connections after ${String(timeoutMs)}ms.`));
      }, timeoutMs);

      Promise.all(states.map(async (state) => {
        await state.connectLifecyclePromise;
        await state.disconnectLifecyclePromise;
      }))
        .then(() => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
    }).catch((error) => {
      this.logger.error(
        `Failed to close Bun websocket connections within ${String(timeoutMs)}ms.`,
        error,
        LIFECYCLE_LOG_CONTEXT,
      );
    });
  }

  joinRoom(socketId: string, room: string): void {
    let rooms = this.socketRooms.get(socketId);

    if (!rooms) {
      rooms = new Set<string>();
      this.socketRooms.set(socketId, rooms);
    }

    rooms.add(room);

    let sockets = this.roomSockets.get(room);
    if (!sockets) {
      sockets = new Set<string>();
      this.roomSockets.set(room, sockets);
    }

    sockets.add(socketId);
  }

  leaveRoom(socketId: string, room: string): void {
    const rooms = this.socketRooms.get(socketId);
    rooms?.delete(room);
    if (rooms && rooms.size === 0) {
      this.socketRooms.delete(socketId);
    }

    const sockets = this.roomSockets.get(room);
    sockets?.delete(socketId);
    if (sockets && sockets.size === 0) {
      this.roomSockets.delete(room);
    }
  }

  broadcastToRoom(room: string, event: string, data: unknown): void {
    const socketIds = this.roomSockets.get(room);

    if (!socketIds) {
      return;
    }

    const message = JSON.stringify({ data, event });

    for (const socketId of socketIds) {
      const socket = this.socketRegistry.get(socketId);

      if (!socket || socket.readyState !== 1) {
        continue;
      }

      const result = socket.send(message);

      if (result === 0) {
        this.unregisterSocket(socketId);
        this.logger.warn(
          `WebSocket connection ${socketId} dropped a room broadcast because the socket was unavailable.`,
          LIFECYCLE_LOG_CONTEXT,
        );
      }
    }
  }

  getRooms(socketId: string): ReadonlySet<string> {
    const rooms = this.socketRooms.get(socketId);

    if (!rooms) {
      return new Set<string>();
    }

    return new Set<string>(rooms);
  }

  private unregisterSocket(socketId: string): void {
    this.socketRegistry.delete(socketId);
    this.socketStates.delete(socketId);

    const rooms = this.socketRooms.get(socketId);
    if (rooms) {
      for (const room of rooms) {
        const sockets = this.roomSockets.get(room);
        sockets?.delete(socketId);
        if (sockets && sockets.size === 0) {
          this.roomSockets.delete(room);
        }
      }

      this.socketRooms.delete(socketId);
    }
  }
}
