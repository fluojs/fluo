import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import type { HttpApplicationAdapter } from '@fluojs/http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

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
  WebSocketGatewayServerBackedOptions,
  WebSocketUpgradeRejection,
  WebSocketRoomService,
} from '../types.js';
import type { WebSocketModuleOptions } from './node-types.js';

interface GatewayAttachment {
  bindingTarget: GatewayBindingTarget;
  descriptors: WebSocketGatewayDescriptor[];
  path: string;
  server: WebSocketServer;
}

interface GatewayAttachmentGroup {
  attachmentsByPath: Map<string, GatewayAttachment>;
  target: GatewayBindingTarget;
}

interface ConnectionHandlerState {
  bufferedDisconnect: BufferedDisconnectEvent | undefined;
  bufferedMessages: RawData[];
  bufferedMessagesStartIndex: number;
  enqueuedMessageCount: number;
  handlerQueue: Promise<void>;
  handlersReady: boolean;
  processingMessageQueue: boolean;
  queuedMessages: RawData[];
  queuedMessagesStartIndex: number;
  resolved: ResolvedGatewayInstance[];
  socketId: string;
}

interface NodeUpgradeServer {
  listenerCount(event: 'upgrade'): number;
  off(event: 'upgrade', listener: NodeUpgradeListener): this;
  on(event: 'upgrade', listener: NodeUpgradeListener): this;
}

interface OwnedGatewayServer {
  close(callback?: (error?: Error) => void): void;
  listen(port: number, callback?: () => void): this;
  readonly listening: boolean;
}

interface OwnedGatewayServerRegistration {
  listener: NodeUpgradeListener;
  port: number;
  server: OwnedGatewayServer & NodeUpgradeServer;
}

type NodeUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

type BufferedDisconnectEvent = {
  code: number;
  reason: Buffer;
};

function resolveHttpStatusText(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 413:
      return 'Payload Too Large';
    case 426:
      return 'Upgrade Required';
    case 429:
      return 'Too Many Requests';
    case 500:
      return 'Internal Server Error';
    case 503:
      return 'Service Unavailable';
    default:
      return 'Rejected';
  }
}

function isUpgradeRejection(value: unknown): value is WebSocketUpgradeRejection {
  return typeof value === 'object' && value !== null && 'status' in value;
}

function isHttpExceptionLike(error: unknown): error is { message: string; status: number } {
  return typeof error === 'object' && error !== null && 'message' in error && 'status' in error;
}

function resolveMessageByteLength(data: RawData): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data);
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (Array.isArray(data)) {
    return data.reduce((length, chunk) => length + chunk.byteLength, 0);
  }

  return data.byteLength;
}

const DEFAULT_WEBSOCKET_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 256;
const DEFAULT_MAX_BUFFERED_AMOUNT_BYTES = 1_048_576;
const DEFAULT_MAX_WEBSOCKET_CONNECTIONS = 1_000;
const DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES = 1_048_576;
const DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000;

type ServerBackedRealtimeCapability = {
  kind: 'server-backed';
  reason?: string;
  server: unknown;
};

type GatewayBindingTarget =
  | {
      key: 'application-server';
      kind: 'application-server';
    }
  | {
      key: `owned-server:${number}`;
      kind: 'owned-server';
      port: number;
    };

type RealtimeAwareHttpApplicationAdapter = HttpApplicationAdapter & {
  getRealtimeCapability?: () =>
    | ServerBackedRealtimeCapability
    | {
        kind: 'fetch-style' | 'unsupported';
        reason: string;
      };
};

function hasNodeUpgradeServer(value: unknown): value is NodeUpgradeServer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybeServer = value as { off?: unknown; on?: unknown };

  return typeof maybeServer.on === 'function' && typeof maybeServer.off === 'function';
}

function resolveServerBackedRealtimeCapability(
  adapter: RealtimeAwareHttpApplicationAdapter,
): ServerBackedRealtimeCapability {
  if (typeof adapter.getRealtimeCapability !== 'function') {
    throw new Error(
      'WebSocket gateway bootstrap requires an HTTP adapter with getRealtimeCapability(). Use a platform adapter that exposes a server-backed realtime capability.',
    );
  }

  const capability = adapter.getRealtimeCapability();

  if (capability.kind !== 'server-backed') {
    throw new Error(
      `WebSocket gateway bootstrap requires a server-backed realtime capability. ${capability.reason}`,
    );
  }

  return capability;
}

function rejectUpgradeRequest(socket: Duplex): void {
  if (socket.destroyed || socket.writableEnded) {
    return;
  }

  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

function rejectBadUpgradeRequest(socket: Duplex): void {
  if (socket.destroyed || socket.writableEnded) {
    return;
  }

  socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

function rejectUpgradeRequestWithStatus(socket: Duplex, rejection: WebSocketUpgradeRejection): void {
  if (socket.destroyed || socket.writableEnded) {
    return;
  }

  const body = rejection.body ?? '';
  let response = `HTTP/1.1 ${String(rejection.status)} ${resolveHttpStatusText(rejection.status)}\r\n`;

  for (const [header, value] of Object.entries(rejection.headers ?? {})) {
    response += `${header}: ${value}\r\n`;
  }

  response += `Connection: close\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`;
  socket.write(response);
  socket.destroy();
}

/**
 * Lifecycle service that discovers WebSocket gateways, attaches upgrade listeners, and manages room state.
 *
 * @remarks
 * This service preserves the documented runtime behavior for shared-path discovery order, optional server-backed
 * listeners, buffered pre-ready events, heartbeat handling, and graceful shutdown.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, WEBSOCKET_OPTIONS_INTERNAL)
export class NodeWebSocketGatewayLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, WebSocketRoomService
{
  private attachments: GatewayAttachment[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private ownedUpgradeServers: OwnedGatewayServerRegistration[] = [];
  private pendingUpgradeReservations = 0;
  private readonly pingPending = new Set<string>();
  private readonly pingSentAt = new Map<string, number>();
  private readonly roomSockets = new Map<string, Set<string>>();
  private shutdownPromise: Promise<void> | undefined;
  private readonly socketRegistry = new Map<string, WebSocket>();
  private readonly socketRooms = new Map<string, Set<string>>();
  private upgradeListener: NodeUpgradeListener | undefined;
  private upgradeServer: NodeUpgradeServer | undefined;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly adapter: HttpApplicationAdapter,
    private readonly moduleOptions: WebSocketModuleOptions,
  ) {}

  /**
   * Discovers gateway classes and attaches their WebSocket servers once per application lifecycle.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.upgradeListener || this.ownedUpgradeServers.length > 0 || this.attachments.length > 0) {
      return;
    }

    const descriptors = discoverGatewayDescriptors(this.compiledModules, this.logger, 'WebSocketGatewayLifecycleService');

    if (descriptors.length === 0) {
      return;
    }

    await this.prepareGatewayAttachments(descriptors);
    this.startHeartbeatIfEnabled();
  }

  /**
   * Shuts down websocket listeners and connection tracking during application shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Shuts down websocket listeners and connection tracking when the containing module is destroyed.
   */
  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private async prepareGatewayAttachments(
    descriptors: WebSocketGatewayDescriptor[],
  ): Promise<void> {
    const attachmentGroups = this.buildGatewayAttachmentGroups(descriptors);

    for (const group of attachmentGroups.values()) {
      this.attachConnectionHandlersToServers(group.attachmentsByPath);
    }

    await this.attachGatewayServers(attachmentGroups);
    this.attachments = Array.from(attachmentGroups.values()).flatMap((group) => Array.from(group.attachmentsByPath.values()));
  }

  private async attachGatewayServers(
    attachmentGroups: Map<string, GatewayAttachmentGroup>,
  ): Promise<void> {
    for (const group of attachmentGroups.values()) {
      if (group.target.kind === 'application-server') {
        this.attachUpgradeServerListener(group.attachmentsByPath);
        continue;
      }

      await this.attachOwnedGatewayServerListener(group);
    }
  }

  private attachUpgradeServerListener(attachmentsByPath: Map<string, GatewayAttachment>): void {
    const upgradeServer = this.resolveUpgradeServer();
    const listener = this.createUpgradeListener(upgradeServer, attachmentsByPath);

    upgradeServer.on('upgrade', listener);
    this.upgradeServer = upgradeServer;
    this.upgradeListener = listener;
  }

  private async attachOwnedGatewayServerListener(group: GatewayAttachmentGroup): Promise<void> {
    if (group.target.kind !== 'owned-server') {
      return;
    }

    const server = createOwnedGatewayServer();
    const listener = this.createUpgradeListener(server, group.attachmentsByPath);

    server.on('upgrade', listener);
    await this.listenOwnedGatewayServer(server, group.target.port);
    this.ownedUpgradeServers.push({
      listener,
      port: group.target.port,
      server,
    });
  }

  private startHeartbeatIfEnabled(): void {
    const heartbeat = this.moduleOptions.heartbeat;

    if (heartbeat?.enabled === false) {
      return;
    }

    const intervalMs = heartbeat?.intervalMs ?? DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS;
    const timeoutMs = heartbeat?.timeoutMs ?? intervalMs;
    this.startHeartbeat(intervalMs, timeoutMs);
  }

  private buildGatewayAttachmentGroups(
    descriptors: WebSocketGatewayDescriptor[],
  ): Map<string, GatewayAttachmentGroup> {
    const attachmentGroups = new Map<string, GatewayAttachmentGroup>();

    for (const descriptor of descriptors) {
      const bindingTarget = this.resolveBindingTarget(descriptor);
      const group = attachmentGroups.get(bindingTarget.key) ?? this.createAttachmentGroup(bindingTarget);
      const current = group.attachmentsByPath.get(descriptor.path);

      if (current) {
        current.descriptors.push(descriptor);
        attachmentGroups.set(bindingTarget.key, group);
        continue;
      }

      group.attachmentsByPath.set(descriptor.path, {
        bindingTarget,
        descriptors: [descriptor],
        path: descriptor.path,
        server: new WebSocketServer({
          maxPayload: this.resolveMaxPayloadBytes(),
          noServer: true,
        }),
      });
      attachmentGroups.set(bindingTarget.key, group);
    }

    return attachmentGroups;
  }

  private createAttachmentGroup(target: GatewayBindingTarget): GatewayAttachmentGroup {
    return {
      attachmentsByPath: new Map<string, GatewayAttachment>(),
      target,
    };
  }

  private resolveBindingTarget(descriptor: WebSocketGatewayDescriptor): GatewayBindingTarget {
    const serverBacked = descriptor.serverBacked;

    if (!serverBacked) {
      return {
        key: 'application-server',
        kind: 'application-server',
      };
    }

    const port = this.resolveServerBackedPort(descriptor.path, serverBacked);

    return {
      key: `owned-server:${String(port)}` as `owned-server:${number}`,
      kind: 'owned-server',
      port,
    };
  }

  private resolveServerBackedPort(
    path: string,
    options: WebSocketGatewayServerBackedOptions,
  ): number {
    if (!isFinitePositiveInteger(options.port)) {
      throw new Error(
        `WebSocket gateway serverBacked.port for path ${path} must be a finite positive integer.`,
      );
    }

    return options.port;
  }

  private attachConnectionHandlersToServers(attachmentsByPath: Map<string, GatewayAttachment>): void {
    for (const attachment of attachmentsByPath.values()) {
      attachment.server.on('connection', (socket: WebSocket, request: IncomingMessage) => {
        void this.bindConnectionHandlers(attachment.descriptors, socket, request);
      });
    }
  }

  private createUpgradeListener(
    upgradeServer: NodeUpgradeServer,
    attachmentsByPath: Map<string, GatewayAttachment>,
  ): NodeUpgradeListener {
    return (request, socket, head) => {
      socket.pause();

      void this.handleUpgradeRequest(upgradeServer, attachmentsByPath, request, socket, head)
        .catch((error) => {
          this.logger.error('WebSocket upgrade admission failed.', error, 'WebSocketGatewayLifecycleService');
          rejectUpgradeRequestWithStatus(socket, {
            body: 'Internal server error',
            status: 500,
          });
        })
        .finally(() => {
          if (!socket.destroyed) {
            socket.resume();
          }
        });
    };
  }

  private async handleUpgradeRequest(
    upgradeServer: NodeUpgradeServer,
    attachmentsByPath: Map<string, GatewayAttachment>,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let attachment: GatewayAttachment | undefined;
    let targetPath: string;

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      targetPath = normalizeGatewayPath(url.pathname);
      attachment = attachmentsByPath.get(targetPath);
    } catch {
      rejectBadUpgradeRequest(socket);
      return;
    }

    if (!attachment) {
      if (upgradeServer.listenerCount('upgrade') === 1) {
        rejectUpgradeRequest(socket);
      }
      return;
    }

    const rejection = await this.resolveUpgradeRejection(request, targetPath);

    if (rejection) {
      rejectUpgradeRequestWithStatus(socket, rejection);
      return;
    }

    try {
      attachment.server.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        attachment.server.emit('connection', websocket, request);
      });
    } catch (error) {
      this.releaseUpgradeReservation();
      throw error;
    }
  }

  private resolveUpgradeServer(): NodeUpgradeServer {
    const capability = resolveServerBackedRealtimeCapability(this.adapter);
    const server = capability.server;

    if (!hasNodeUpgradeServer(server)) {
      throw new Error(
        'WebSocket gateway bootstrap requires the selected realtime capability to expose a Node HTTP/S server that supports upgrade listeners.',
      );
    }

    return server;
  }

  private async bindConnectionHandlers(
    descriptors: WebSocketGatewayDescriptor[],
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    const state = this.createConnectionHandlerState();

    this.registerSocketConnection(state, socket);
    this.attachConnectionListeners(state, socket, request);

    await this.resolveConnectionGateways(descriptors, state);
    await this.runConnectHandlers(state, socket, request);
    await this.finalizeConnectionBinding(state, socket, request);
  }

  private registerSocketConnection(
    state: ConnectionHandlerState,
    socket: WebSocket,
  ): void {
    this.releaseUpgradeReservation();
    this.socketRegistry.set(state.socketId, socket);
  }

  private async finalizeConnectionBinding(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    state.handlersReady = true;
    this.replayBufferedConnectionEvents(state, socket, request);
    await state.handlerQueue;
  }

  private createConnectionHandlerState(): ConnectionHandlerState {
    return {
      bufferedDisconnect: undefined,
      bufferedMessages: [],
      bufferedMessagesStartIndex: 0,
      enqueuedMessageCount: 0,
      handlerQueue: Promise.resolve(),
      handlersReady: false,
      processingMessageQueue: false,
      queuedMessages: [],
      queuedMessagesStartIndex: 0,
      resolved: [],
      socketId: randomUUID(),
    };
  }

  private getBufferedMessageCount(state: ConnectionHandlerState): number {
    return state.bufferedMessages.length - (state.bufferedMessagesStartIndex ?? 0);
  }

  private getQueuedMessageCount(state: ConnectionHandlerState): number {
    return state.queuedMessages.length - (state.queuedMessagesStartIndex ?? 0);
  }

  private maybeCompactBufferedMessages(state: ConnectionHandlerState): void {
    const startIndex = state.bufferedMessagesStartIndex ?? 0;

    if (startIndex === 0 || startIndex < state.bufferedMessages.length / 2) {
      return;
    }

    state.bufferedMessages = state.bufferedMessages.slice(startIndex);
    state.bufferedMessagesStartIndex = 0;
  }

  private clearBufferedMessages(state: ConnectionHandlerState): void {
    state.bufferedMessages = [];
    state.bufferedMessagesStartIndex = 0;
  }

  private maybeCompactQueuedMessages(state: ConnectionHandlerState): void {
    const startIndex = state.queuedMessagesStartIndex ?? 0;

    if (startIndex === 0 || startIndex < state.queuedMessages.length / 2) {
      return;
    }

    state.queuedMessages = state.queuedMessages.slice(startIndex);
    state.queuedMessagesStartIndex = 0;
  }

  private clearQueuedMessages(state: ConnectionHandlerState): void {
    state.queuedMessages = [];
    state.queuedMessagesStartIndex = 0;
    state.enqueuedMessageCount = 0;
  }

  private enqueueMessageDispatch(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
    data: RawData,
  ): void {
    const limit = isFinitePositiveInteger(this.moduleOptions.buffer?.maxPendingMessagesPerSocket)
      ? this.moduleOptions.buffer.maxPendingMessagesPerSocket
      : DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
    const policy = this.moduleOptions.buffer?.overflowPolicy ?? 'drop-oldest';

    if (this.getQueuedMessageCount(state) >= limit) {
      if (policy === 'close') {
        socket.terminate();
        this.clearQueuedMessages(state);
        this.unregisterSocket(state.socketId);
        this.logger.warn(
          `WebSocket connection ${state.socketId} exceeded ready-state message queue limit (${String(limit)}). Connection terminated.`,
          'WebSocketGatewayLifecycleService',
        );
        return;
      }

      if (policy === 'drop-oldest') {
        state.queuedMessagesStartIndex = (state.queuedMessagesStartIndex ?? 0) + 1;
        this.maybeCompactQueuedMessages(state);
        this.logger.warn(
          `WebSocket connection ${state.socketId} dropped the oldest ready-state message because queue limit (${String(limit)}) was reached.`,
          'WebSocketGatewayLifecycleService',
        );
      } else {
        this.logger.warn(
          `WebSocket connection ${state.socketId} dropped a ready-state message because queue limit (${String(limit)}) was reached.`,
          'WebSocketGatewayLifecycleService',
        );
        return;
      }
    }

    state.queuedMessages.push(data);
    state.enqueuedMessageCount = this.getQueuedMessageCount(state);

    if (state.processingMessageQueue) {
      return;
    }

    state.processingMessageQueue = true;
    state.handlerQueue = this.drainMessageQueue(state, socket, request)
      .finally(() => {
        state.processingMessageQueue = false;
        state.enqueuedMessageCount = this.getQueuedMessageCount(state);
      })
      .catch((error) => {
        this.logger.error('WebSocket gateway message dispatch failed.', error, 'WebSocketGatewayLifecycleService');
      });
  }

  private async drainMessageQueue(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    while ((state.queuedMessagesStartIndex ?? 0) < state.queuedMessages.length) {
      const nextMessage = state.queuedMessages[state.queuedMessagesStartIndex ?? 0];
      state.queuedMessagesStartIndex = (state.queuedMessagesStartIndex ?? 0) + 1;
      state.enqueuedMessageCount = this.getQueuedMessageCount(state);

      if (nextMessage === undefined) {
        continue;
      }

      await this.handleMessage(
        state.resolved,
        socket,
        request,
        nextMessage,
      );
    }

    this.clearQueuedMessages(state);
  }

  private async handleMessage(
    resolved: readonly ResolvedGatewayInstance[],
    socket: WebSocket,
    request: IncomingMessage,
    data: RawData,
  ): Promise<void> {
    await dispatchGatewayMessage(
      resolved,
      socket,
      request,
      data,
      this.logger,
      'WebSocketGatewayLifecycleService',
    );
  }

  private enqueueDisconnectDispatch(
    state: ConnectionHandlerState,
    socket: WebSocket,
    disconnectEvent: BufferedDisconnectEvent,
  ): void {
    state.handlerQueue = state.handlerQueue
      .then(async () => {
        await this.handleDisconnect(
          state.resolved,
          socket,
          disconnectEvent.code,
          disconnectEvent.reason,
          state.socketId,
        );
      })
      .catch((error) => {
        this.logger.error('WebSocket gateway disconnect dispatch failed.', error, 'WebSocketGatewayLifecycleService');
      });
  }

  private attachConnectionListeners(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
  ): void {
    socket.on('message', (data: RawData) => {
      if (this.closeOversizedPayload(state.socketId, socket, data)) {
        return;
      }

      if (!state.handlersReady) {
        this.bufferIncomingMessage(state, socket, data);
        return;
      }

      this.enqueueMessageDispatch(state, socket, request, data);
    });

    socket.on('pong', () => {
      this.pingPending.delete(state.socketId);
      this.pingSentAt.delete(state.socketId);
    });

    socket.on('error', (error: Error) => {
      this.unregisterSocket(state.socketId);
      this.logger.error('WebSocket gateway socket emitted an error.', error, 'WebSocketGatewayLifecycleService');
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.unregisterSocket(state.socketId);

      const disconnectEvent: BufferedDisconnectEvent = { code, reason };

      if (!state.handlersReady) {
        state.bufferedDisconnect = disconnectEvent;
        return;
      }

      this.enqueueDisconnectDispatch(state, socket, disconnectEvent);
    });
  }

  private bufferIncomingMessage(
    state: ConnectionHandlerState,
    socket: WebSocket,
    data: RawData,
  ): void {
    const limit = isFinitePositiveInteger(this.moduleOptions.buffer?.maxPendingMessagesPerSocket)
      ? this.moduleOptions.buffer.maxPendingMessagesPerSocket
      : DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
    const policy = this.moduleOptions.buffer?.overflowPolicy ?? 'drop-oldest';

    if (this.getBufferedMessageCount(state) < limit) {
      state.bufferedMessages.push(data);
      return;
    }

    if (policy === 'close') {
      socket.terminate();
      this.clearBufferedMessages(state);
      this.logger.warn(
        `WebSocket connection ${state.socketId} exceeded pending message buffer limit (${String(limit)}). Connection terminated.`,
        'WebSocketGatewayLifecycleService',
      );
      return;
    }

    if (policy === 'drop-newest') {
      this.logger.warn(
        `WebSocket connection ${state.socketId} dropped an incoming message due to pending buffer limit (${String(limit)}).`,
        'WebSocketGatewayLifecycleService',
      );
      return;
    }

    state.bufferedMessagesStartIndex = (state.bufferedMessagesStartIndex ?? 0) + 1;
    this.maybeCompactBufferedMessages(state);
    state.bufferedMessages.push(data);
    this.logger.warn(
      `WebSocket connection ${state.socketId} dropped the oldest pending message due to buffer limit (${String(limit)}).`,
      'WebSocketGatewayLifecycleService',
    );
  }

  private async resolveConnectionGateways(
    descriptors: WebSocketGatewayDescriptor[],
    state: ConnectionHandlerState,
  ): Promise<void> {
    for (const descriptor of descriptors) {
      const instance = await resolveGatewayInstance(
        this.runtimeContainer,
        descriptor,
        this.logger,
        'WebSocketGatewayLifecycleService',
      );

      if (instance !== undefined) {
        state.resolved.push({ descriptor, instance });
      }
    }
  }

  private async runConnectHandlers(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    for (const { descriptor, instance } of state.resolved) {
      await runGatewayHandlers(
        instance,
        descriptor,
        'connect',
        [socket, request, state.socketId],
        this.logger,
        'WebSocketGatewayLifecycleService',
      );
    }
  }

  private replayBufferedConnectionEvents(
    state: ConnectionHandlerState,
    socket: WebSocket,
    request: IncomingMessage,
  ): void {
    for (let index = state.bufferedMessagesStartIndex ?? 0; index < state.bufferedMessages.length; index += 1) {
      const message = state.bufferedMessages[index];

      this.enqueueMessageDispatch(state, socket, request, message);
    }

    if (state.bufferedDisconnect) {
      this.enqueueDisconnectDispatch(state, socket, state.bufferedDisconnect);
      state.bufferedDisconnect = undefined;
      this.clearBufferedMessages(state);
      return;
    }

    this.clearBufferedMessages(state);

    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
      this.unregisterSocket(state.socketId);
    }
  }

  private async handleDisconnect(
    resolved: ResolvedGatewayInstance[],
    socket: WebSocket,
    code: number,
    reason: Buffer,
    socketId: string,
  ): Promise<void> {
    await dispatchGatewayDisconnect(
      resolved,
      socket,
      code,
      reason.toString('utf8'),
      socketId,
      this.logger,
      'WebSocketGatewayLifecycleService',
    );
  }

  private async resolveUpgradeRejection(
    request: IncomingMessage,
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

      if (isUpgradeRejection(result)) {
        this.releaseUpgradeReservation();
        return result;
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

  private closeOversizedPayload(socketId: string, socket: WebSocket, data: RawData): boolean {
    const maxPayloadBytes = this.resolveMaxPayloadBytes();

    if (resolveMessageByteLength(data) <= maxPayloadBytes) {
      return false;
    }

    socket.close(1009, 'Payload too large');
    this.logger.warn(
      `WebSocket connection ${socketId} exceeded payload limit (${String(maxPayloadBytes)} bytes). Connection closed.`,
      'WebSocketGatewayLifecycleService',
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

  private resolveShutdownTimeoutMs(): number {
    const configured = this.moduleOptions.shutdown?.timeoutMs;

    if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_WEBSOCKET_SHUTDOWN_TIMEOUT_MS;
    }

    return Math.floor(configured);
  }

  private closeServerWithTimeout(attachment: GatewayAttachment, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(
          new Error(
            `Timed out while closing websocket server for path "${attachment.path}" after ${String(timeoutMs)}ms.`,
          ),
        );
      }, timeoutMs);

      attachment.server.close((error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
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
    this.stopHeartbeat();
    this.detachUpgradeServerListener();

    const attachments = this.attachments.splice(0);
    const ownedUpgradeServers = this.ownedUpgradeServers.splice(0);
    const shutdownTimeoutMs = this.resolveShutdownTimeoutMs();

    await this.closeGatewayAttachments(attachments, shutdownTimeoutMs);
    await this.closeOwnedUpgradeServers(ownedUpgradeServers, shutdownTimeoutMs);
    this.clearConnectionTrackingState();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private detachUpgradeServerListener(): void {
    if (this.upgradeServer && this.upgradeListener) {
      this.upgradeServer.off('upgrade', this.upgradeListener);
    }

    for (const registration of this.ownedUpgradeServers) {
      registration.server.off('upgrade', registration.listener);
    }

    this.upgradeServer = undefined;
    this.upgradeListener = undefined;
  }

  private async closeOwnedUpgradeServers(
    registrations: readonly OwnedGatewayServerRegistration[],
    shutdownTimeoutMs: number,
  ): Promise<void> {
    await Promise.all(
      registrations.map(async (registration) => {
        try {
          await this.closeOwnedUpgradeServerWithTimeout(registration, shutdownTimeoutMs);
        } catch (error) {
          this.logger.error(
            `Failed to close owned websocket listener on port ${String(registration.port)} within ${String(shutdownTimeoutMs)}ms.`,
            error,
            'WebSocketGatewayLifecycleService',
          );
        }
      }),
    );
  }

  private closeOwnedUpgradeServerWithTimeout(
    registration: OwnedGatewayServerRegistration,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new Error(`Timed out while closing owned websocket listener on port ${String(registration.port)} after ${String(timeoutMs)}ms.`));
      }, timeoutMs);

      registration.server.close((error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private listenOwnedGatewayServer(server: OwnedGatewayServer, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const httpServer = server as HttpServer;
      const onError = (error: Error) => {
        reject(error);
      };

      httpServer.once('error', onError);
      server.listen(port, () => {
        httpServer.off('error', onError);
        resolve();
      });
    });
  }

  private async closeGatewayAttachments(
    attachments: readonly GatewayAttachment[],
    shutdownTimeoutMs: number,
  ): Promise<void> {
    await Promise.all(
      attachments.map(async (attachment) => {
        this.terminateAttachmentClients(attachment);
        await this.closeGatewayAttachment(attachment, shutdownTimeoutMs);
      }),
    );
  }

  private terminateAttachmentClients(attachment: GatewayAttachment): void {
    for (const client of attachment.server.clients) {
      client.terminate();
    }
  }

  private async closeGatewayAttachment(
    attachment: GatewayAttachment,
    shutdownTimeoutMs: number,
  ): Promise<void> {
    try {
      await this.closeServerWithTimeout(attachment, shutdownTimeoutMs);
    } catch (error) {
      this.logger.error(
        `Failed to close websocket server for path ${attachment.path} within ${String(shutdownTimeoutMs)}ms.`,
        error,
        'WebSocketGatewayLifecycleService',
      );
    }
  }

  private clearConnectionTrackingState(): void {
    this.socketRegistry.clear();
    this.socketRooms.clear();
    this.roomSockets.clear();
    this.pingPending.clear();
    this.pingSentAt.clear();
    this.pendingUpgradeReservations = 0;
  }

  /**
   * Adds one socket to an in-memory room membership set.
   *
   * @param socketId Socket identifier to add.
   * @param room Room identifier to join.
   */
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

  /**
   * Removes one socket from an in-memory room membership set.
   *
   * @param socketId Socket identifier to remove.
   * @param room Room identifier to leave.
   */
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

  /**
   * Broadcasts one JSON-encoded event frame to every open socket currently joined to a room.
   *
   * @param room Room identifier that should receive the event.
   * @param event Event name delivered to room members.
   * @param data Payload delivered with the event.
   */
  broadcastToRoom(room: string, event: string, data: unknown): void {
    const socketIds = this.roomSockets.get(room);

    if (!socketIds) {
      return;
    }

    const message = JSON.stringify({ data, event });
    const maxBufferedAmountBytes = isFinitePositiveInteger(this.moduleOptions.backpressure?.maxBufferedAmountBytes)
      ? this.moduleOptions.backpressure.maxBufferedAmountBytes
      : DEFAULT_MAX_BUFFERED_AMOUNT_BYTES;
    const backpressurePolicy = this.moduleOptions.backpressure?.policy ?? 'drop';

    for (const socketId of socketIds) {
      const socket = this.socketRegistry.get(socketId);
      if (socket && socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > maxBufferedAmountBytes) {
          if (backpressurePolicy === 'close') {
            socket.terminate();
            this.unregisterSocket(socketId);
            this.logger.warn(
              `WebSocket connection ${socketId} exceeded bufferedAmount threshold (${String(maxBufferedAmountBytes)} bytes). Connection terminated.`,
              'WebSocketGatewayLifecycleService',
            );
            continue;
          }

          this.logger.warn(
            `WebSocket connection ${socketId} exceeded bufferedAmount threshold (${String(maxBufferedAmountBytes)} bytes). Broadcast frame dropped.`,
            'WebSocketGatewayLifecycleService',
          );
          continue;
        }

        socket.send(message);
      }
    }
  }

  /**
   * Returns the current in-memory room snapshot for one socket.
   *
   * @param socketId Socket identifier to inspect.
   * @returns The room set currently tracked for that socket.
   */
  getRooms(socketId: string): ReadonlySet<string> {
    const rooms = this.socketRooms.get(socketId);

    if (!rooms) {
      return new Set<string>();
    }

    return new Set<string>(rooms);
  }

  private startHeartbeat(intervalMs: number, timeoutMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [socketId, socket] of this.socketRegistry) {
        if (this.pingPending.has(socketId)) {
          const pingAt = this.pingSentAt.get(socketId);
          const elapsed = pingAt === undefined ? timeoutMs : now - pingAt;

          if (elapsed >= timeoutMs) {
            socket.terminate();
            this.unregisterSocket(socketId);
          }
          continue;
        }

        if (socket.readyState === WebSocket.OPEN) {
          this.pingPending.add(socketId);
          this.pingSentAt.set(socketId, now);
          socket.ping();
        }
      }
    }, intervalMs);
  }

  private unregisterSocket(socketId: string): void {
    this.socketRegistry.delete(socketId);
    this.pingPending.delete(socketId);
    this.pingSentAt.delete(socketId);

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

function createOwnedGatewayServer(): OwnedGatewayServer & NodeUpgradeServer {
  return createHttpServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  }) as OwnedGatewayServer & NodeUpgradeServer;
}
