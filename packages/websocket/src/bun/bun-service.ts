import { Inject } from '@konekti/core';
import type { Container } from '@konekti/di';
import type { ApplicationLogger, CompiledModule, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@konekti/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@konekti/runtime/internal';
import type {
  BunServerWebSocket,
  BunWebSocketBinding,
  BunWebSocketBindingHost,
  BunWebSocketMessage,
  BunServerLike,
} from './bun-types.js';
import type { HttpApplicationAdapter } from '@konekti/http';

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
  descriptors: readonly WebSocketGatewayDescriptor[];
  enqueuedMessageCount: number;
  handlerQueue: Promise<void>;
  handlersReady: boolean;
  processingMessageQueue: boolean;
  queuedMessages: BunWebSocketMessage[];
  queuedMessagesStartIndex: number;
  request: Request;
  resolved: ResolvedGatewayInstance[];
  socketId: string;
}

interface BunSocketData {
  state: ConnectionHandlerState;
}

const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 256;
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
      'Bun WebSocket gateway bootstrap requires an HTTP adapter with getRealtimeCapability(). Use @konekti/platform-bun together with @konekti/websocket/bun.',
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

function isWebSocketUpgradeRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, WEBSOCKET_OPTIONS_INTERNAL])
export class BunWebSocketGatewayLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, WebSocketRoomService
{
  private readonly roomSockets = new Map<string, Set<string>>();
  private shutdownPromise: Promise<void> | undefined;
  private readonly socketRegistry = new Map<string, BunServerWebSocket<BunSocketData>>();
  private readonly socketRooms = new Map<string, Set<string>>();

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

    resolveSupportedFetchStyleRealtimeCapability(this.adapter);

    if (!hasBunWebSocketBindingHost(this.adapter)) {
      throw new Error(
        'Bun WebSocket gateway bootstrap requires the selected adapter to expose Bun websocket binding configuration. Use @konekti/platform-bun with @konekti/websocket/bun.',
      );
    }

    const bunAdapter = this.adapter as HttpApplicationAdapter & BunWebSocketBindingHost;
    bunAdapter.configureWebSocketBinding(this.createBinding(descriptors));
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
    if (!isWebSocketUpgradeRequest(request)) {
      return new Response(null, { status: 426 });
    }

    let targetPath: string;

    try {
      targetPath = normalizeGatewayPath(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }

    const descriptors = descriptorsByPath.get(targetPath);

    if (!descriptors) {
      return new Response(null, { status: 404 });
    }

    const state = this.createConnectionHandlerState(request, [...descriptors]);
    const upgraded = server.upgrade(request, { data: { state } });

    if (!upgraded) {
      return new Response(null, { status: 400 });
    }

    return undefined;
  }

  private async bindConnectionHandlers(socket: BunServerWebSocket<BunSocketData>): Promise<void> {
    const { state } = socket.data;

    this.socketRegistry.set(state.socketId, socket);

    await this.resolveConnectionGateways(state);
    await this.runConnectHandlers(state, socket);
    await this.finalizeConnectionBinding(state, socket);
  }

  private createConnectionHandlerState(
    request: Request,
    descriptors: readonly WebSocketGatewayDescriptor[],
  ): ConnectionHandlerState {
    return {
      bufferedDisconnect: undefined,
      bufferedMessages: [],
      bufferedMessagesStartIndex: 0,
      descriptors,
      enqueuedMessageCount: 0,
      handlerQueue: Promise.resolve(),
      handlersReady: false,
      processingMessageQueue: false,
      queuedMessages: [],
      queuedMessagesStartIndex: 0,
      request,
      resolved: [],
      socketId: crypto.randomUUID(),
    };
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

    this.socketRegistry.clear();
    this.socketRooms.clear();
    this.roomSockets.clear();
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
