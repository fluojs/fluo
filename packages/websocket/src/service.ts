import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject, type MetadataPropertyKey, type Token } from '@konekti/core';
import { getClassDiMetadata } from '@konekti/core/internal';
import type { Provider, Container } from '@konekti/di';
import type { ApplicationLogger, CompiledModule, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy } from '@konekti/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@konekti/runtime/internal';
import type { HttpApplicationAdapter } from '@konekti/http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { getWebSocketGatewayMetadata, getWebSocketHandlerMetadataEntries } from './metadata.js';
import { WEBSOCKET_OPTIONS_INTERNAL } from './options-token.internal.js';
import type {
  WebSocketGatewayDescriptor,
  WebSocketGatewayHandlerDescriptor,
  WebSocketModuleOptions,
  WebSocketRoomService,
} from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface GatewayAttachment {
  descriptors: WebSocketGatewayDescriptor[];
  path: string;
  server: WebSocketServer;
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
  resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>;
  socketId: string;
}

interface NodeUpgradeServer {
  listenerCount(event: 'upgrade'): number;
  off(event: 'upgrade', listener: NodeUpgradeListener): this;
  on(event: 'upgrade', listener: NodeUpgradeListener): this;
}

interface ClassProviderLike {
  provide: Token;
  scope?: 'request' | 'singleton' | 'transient';
  useClass: new (...args: unknown[]) => unknown;
}

type NodeUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

type ParsedWebSocketMessage = {
  event?: string;
  payload: unknown;
};

type BufferedDisconnectEvent = {
  code: number;
  reason: Buffer;
};

const DEFAULT_WEBSOCKET_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 256;
const DEFAULT_MAX_BUFFERED_AMOUNT_BYTES = 1_048_576;

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    const classProvider = provider as ClassProviderLike;
    return classProvider.scope ?? getClassDiMetadata(classProvider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function isClassProvider(provider: Provider): provider is ClassProviderLike {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function normalizeGatewayPath(path: string): string {
  if (path === '/') {
    return '/';
  }

  const normalized = `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;

  return normalized === '' ? '/' : normalized;
}

function parseIncomingMessage(data: RawData): ParsedWebSocketMessage {
  const text =
    typeof data === 'string'
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data as Buffer[]).toString('utf8')
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
            : String(data);
  let parsed: unknown = text;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { payload: text };
  }

  if (typeof parsed === 'object' && parsed !== null && 'event' in parsed) {
    const event = (parsed as { event?: unknown }).event;

    if (typeof event === 'string') {
      return {
        event,
        payload: (parsed as { data?: unknown }).data,
      };
    }
  }

  return {
    payload: parsed,
  };
}

function hasNodeUpgradeServer(value: unknown): value is NodeUpgradeServer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybeServer = value as { off?: unknown; on?: unknown };

  return typeof maybeServer.on === 'function' && typeof maybeServer.off === 'function';
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

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, WEBSOCKET_OPTIONS_INTERNAL])
export class WebSocketGatewayLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, WebSocketRoomService
{
  private attachments: GatewayAttachment[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
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

  async onApplicationBootstrap(): Promise<void> {
    if (this.upgradeListener) {
      return;
    }

    const descriptors = this.discoverGatewayDescriptors();

    if (descriptors.length === 0) {
      return;
    }

    const attachmentsByPath = this.prepareGatewayAttachments(descriptors);
    this.attachUpgradeServerListener(attachmentsByPath);
    this.startHeartbeatIfEnabled();
  }

  private prepareGatewayAttachments(
    descriptors: WebSocketGatewayDescriptor[],
  ): Map<string, GatewayAttachment> {
    const attachmentsByPath = this.buildGatewayAttachments(descriptors);
    this.attachConnectionHandlersToServers(attachmentsByPath);
    return attachmentsByPath;
  }

  private attachUpgradeServerListener(attachmentsByPath: Map<string, GatewayAttachment>): void {
    const upgradeServer = this.resolveUpgradeServer();
    const listener = this.createUpgradeListener(upgradeServer, attachmentsByPath);

    upgradeServer.on('upgrade', listener);
    this.upgradeServer = upgradeServer;
    this.upgradeListener = listener;
    this.attachments = Array.from(attachmentsByPath.values());
  }

  private startHeartbeatIfEnabled(): void {
    if (this.moduleOptions.heartbeat?.enabled !== true) {
      return;
    }

    const intervalMs = this.moduleOptions.heartbeat.intervalMs ?? 30_000;
    const timeoutMs = this.moduleOptions.heartbeat.timeoutMs ?? intervalMs;
    this.startHeartbeat(intervalMs, timeoutMs);
  }

  private buildGatewayAttachments(
    descriptors: WebSocketGatewayDescriptor[],
  ): Map<string, GatewayAttachment> {
    const attachmentsByPath = new Map<string, GatewayAttachment>();

    for (const descriptor of descriptors) {
      const current = attachmentsByPath.get(descriptor.path);

      if (current) {
        current.descriptors.push(descriptor);
        continue;
      }

      attachmentsByPath.set(descriptor.path, {
        descriptors: [descriptor],
        path: descriptor.path,
        server: new WebSocketServer({ noServer: true }),
      });
    }

    return attachmentsByPath;
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
      let attachment: GatewayAttachment | undefined;

      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const targetPath = normalizeGatewayPath(url.pathname);
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

      attachment.server.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        attachment.server.emit('connection', websocket, request);
      });
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private resolveUpgradeServer(): NodeUpgradeServer {
    if (typeof this.adapter.getServer !== 'function') {
      throw new Error(
        'WebSocket gateway bootstrap requires an HTTP adapter with getServer(). Use the Node HTTP adapter or provide a compatible adapter implementation.',
      );
    }

    const server = this.adapter.getServer();

    if (!hasNodeUpgradeServer(server)) {
      throw new Error(
        'WebSocket gateway bootstrap requires adapter.getServer() to return a Node HTTP/S server that supports upgrade listeners.',
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

      await this.handleMessage(state.resolved, socket, request, nextMessage);
    }

    this.clearQueuedMessages(state);
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
      const instance = await this.resolveGatewayInstance(descriptor);

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
      await this.runHandlers(instance, descriptor, 'connect', socket, request, state.socketId);
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

  private async handleMessage(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: WebSocket,
    request: IncomingMessage,
    data: RawData,
  ): Promise<void> {
    const parsed = parseIncomingMessage(data);

    for (const { descriptor, instance } of resolved) {
      const handlers = this.selectMessageHandlers(descriptor, parsed.event);

      for (const handler of handlers) {
        await this.invokeGatewayMethod(instance, descriptor, handler, [parsed.payload, socket, request]);
      }
    }
  }

  private selectMessageHandlers(
    descriptor: WebSocketGatewayDescriptor,
    event: string | undefined,
  ): WebSocketGatewayHandlerDescriptor[] {
    return descriptor.handlers.filter(
      (handler) =>
        handler.type === 'message' &&
        (handler.event === undefined || handler.event === event),
    );
  }

  private async handleDisconnect(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: WebSocket,
    code: number,
    reason: Buffer,
    socketId: string,
  ): Promise<void> {
    for (const { descriptor, instance } of resolved) {
      await this.runHandlers(instance, descriptor, 'disconnect', socket, code, reason.toString('utf8'), socketId);
    }
  }

  private async runHandlers(
    instance: unknown,
    descriptor: WebSocketGatewayDescriptor,
    type: WebSocketGatewayHandlerDescriptor['type'],
    ...args: unknown[]
  ): Promise<void> {
    const handlers = descriptor.handlers.filter((handler) => handler.type === type);

    for (const handler of handlers) {
      await this.invokeGatewayMethod(instance, descriptor, handler, args);
    }
  }

  private async invokeGatewayMethod(
    instance: unknown,
    descriptor: WebSocketGatewayDescriptor,
    handler: WebSocketGatewayHandlerDescriptor,
    args: unknown[],
  ): Promise<void> {
    const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `WebSocket gateway handler ${descriptor.targetName}.${handler.methodName} is not callable and was skipped.`,
        'WebSocketGatewayLifecycleService',
      );
      return;
    }

    try {
      await Promise.resolve((value as (this: unknown, ...handlerArgs: unknown[]) => unknown).call(instance, ...args));
    } catch (error) {
      this.logger.error(
        `WebSocket gateway handler ${descriptor.targetName}.${handler.methodName} failed.`,
        error,
        'WebSocketGatewayLifecycleService',
      );
    }
  }

  private async resolveGatewayInstance(descriptor: WebSocketGatewayDescriptor): Promise<unknown | undefined> {
    try {
      return await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      this.logger.error(
        `Failed to resolve WebSocket gateway ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'WebSocketGatewayLifecycleService',
      );
      return undefined;
    }
  }

  private discoverGatewayDescriptors(): WebSocketGatewayDescriptor[] {
    const seenTargets = new Set<Function>();
    const descriptors: WebSocketGatewayDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const gatewayMetadata = getWebSocketGatewayMetadata(candidate.targetType);

      if (!gatewayMetadata) {
        continue;
      }

      if (this.shouldSkipGatewayCandidate(candidate, seenTargets)) {
        continue;
      }

      seenTargets.add(candidate.targetType);
      descriptors.push(this.createGatewayDescriptor(candidate, gatewayMetadata.path));
    }

    return descriptors;
  }

  private shouldSkipGatewayCandidate(candidate: DiscoveryCandidate, seenTargets: Set<Function>): boolean {
    if (candidate.scope !== 'singleton') {
      this.logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @WebSocketGateway() but is registered with ${candidate.scope} scope. WebSocket gateways are registered only for singleton providers.`,
        'WebSocketGatewayLifecycleService',
      );
      return true;
    }

    return seenTargets.has(candidate.targetType);
  }

  private createGatewayDescriptor(candidate: DiscoveryCandidate, path: string): WebSocketGatewayDescriptor {
    return {
      handlers: getWebSocketHandlerMetadataEntries(candidate.targetType.prototype).map((entry) => ({
        event: entry.metadata.event,
        methodKey: entry.propertyKey,
        methodName: methodKeyToName(entry.propertyKey),
        type: entry.metadata.type,
      })),
      moduleName: candidate.moduleName,
      path: normalizeGatewayPath(path),
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
            token: provider as Token,
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
    const shutdownTimeoutMs = this.resolveShutdownTimeoutMs();

    await this.closeGatewayAttachments(attachments, shutdownTimeoutMs);
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

    this.upgradeServer = undefined;
    this.upgradeListener = undefined;
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
