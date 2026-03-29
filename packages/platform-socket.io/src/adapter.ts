import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';

import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import type { HttpApplicationAdapter } from '@konekti/http';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  HTTP_APPLICATION_ADAPTER,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@konekti/runtime';
import {
  getWebSocketGatewayMetadata,
  getWebSocketHandlerMetadataEntries,
  type WebSocketGatewayDescriptor,
  type WebSocketGatewayHandlerDescriptor,
} from '@konekti/websocket';
import { Server, type Namespace, type ServerOptions, type Socket } from 'socket.io';

import { SOCKETIO_OPTIONS } from './tokens.js';
import type { SocketIoModuleOptions, SocketIoRoomService } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface NamespaceAttachment {
  descriptors: WebSocketGatewayDescriptor[];
  namespace: Namespace;
  path: string;
}

interface BufferedMessageEvent {
  acknowledgement?: (...callbackArgs: unknown[]) => void;
  event: string;
  payload: unknown;
}

interface BufferedDisconnectEvent {
  description: unknown;
  reason: string;
}

interface ConnectionHandlerState {
  bufferedDisconnect: BufferedDisconnectEvent | undefined;
  bufferedMessages: BufferedMessageEvent[];
  handlersReady: boolean;
}

interface ClassProviderLike {
  provide: Token;
  scope?: 'request' | 'singleton' | 'transient';
  useClass: new (...args: unknown[]) => unknown;
}

interface NodeHttpServerLike {
}

const DEFAULT_SOCKETIO_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 128;

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value > 0;
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

function isNodeHttpServerLike(value: unknown): value is NodeHttpServerLike {
  return typeof value === 'object' && value !== null;
}

function extractPayload(args: unknown[]): unknown {
  if (args.length === 0) {
    return undefined;
  }

  const effectiveArgs = typeof args.at(-1) === 'function' ? args.slice(0, -1) : args;

  if (effectiveArgs.length === 0) {
    return undefined;
  }

  return effectiveArgs.length === 1 ? effectiveArgs[0] : effectiveArgs;
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, SOCKETIO_OPTIONS])
export class SocketIoLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, SocketIoRoomService
{
  private attachments: NamespaceAttachment[] = [];
  private io: Server | undefined;
  private readonly namespaceContext = new AsyncLocalStorage<string>();
  private readonly socketRegistry = new Map<string, Socket>();
  private shutdownPromise: Promise<void> | undefined;
  private wired = false;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly adapter: HttpApplicationAdapter,
    private readonly moduleOptions: SocketIoModuleOptions,
  ) {}

  getServer(): Server {
    if (this.io) {
      return this.io;
    }

    if (typeof this.adapter.getServer !== 'function') {
      throw new Error(
        'Socket.IO bootstrap requires an HTTP adapter with getServer(). Use the Node HTTP adapter or provide a compatible adapter implementation.',
      );
    }

    const httpServer = this.adapter.getServer();

    if (!isNodeHttpServerLike(httpServer)) {
      throw new Error(
        'Socket.IO bootstrap requires adapter.getServer() to return a Node HTTP/S server instance.',
      );
    }

    this.io = new Server(httpServer as never, this.createServerOptions());
    return this.io;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.wired) {
      return;
    }

    const descriptors = this.discoverGatewayDescriptors();

    if (descriptors.length === 0) {
      return;
    }

    const io = this.getServer();
    const attachments = this.prepareNamespaceAttachments(io, descriptors);

    for (const attachment of attachments) {
      this.bindNamespaceHandlers(attachment);
    }

    this.attachments = attachments;
    this.wired = true;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  joinRoom(socketId: string, room: string, namespacePath?: string): void {
    const socket = this.resolveSocket(socketId);

    if (socket) {
      void socket.join(room);
      return;
    }

    this.resolveRequiredNamespace(namespacePath).in(socketId).socketsJoin(room);
  }

  leaveRoom(socketId: string, room: string, namespacePath?: string): void {
    const socket = this.resolveSocket(socketId);

    if (socket) {
      void socket.leave(room);
      return;
    }

    this.resolveRequiredNamespace(namespacePath).in(socketId).socketsLeave(room);
  }

  broadcastToRoom(room: string, event: string, data: unknown, namespacePath?: string): void {
    this.resolveRequiredNamespace(namespacePath).to(room).emit(event, data);
  }

  getRooms(socketId: string): ReadonlySet<string> {
    const socket = this.socketRegistry.get(socketId);

    if (!socket) {
      return new Set<string>();
    }

    return new Set<string>(socket.rooms);
  }

  private createServerOptions(): Partial<ServerOptions> {
    const options: Partial<ServerOptions> = {};

    if (this.moduleOptions.cors !== undefined) {
      options.cors = this.moduleOptions.cors;
    }

    if (this.moduleOptions.transports !== undefined) {
      options.transports = this.moduleOptions.transports;
    }

    return options;
  }

  private prepareNamespaceAttachments(io: Server, descriptors: WebSocketGatewayDescriptor[]): NamespaceAttachment[] {
    const attachmentsByPath = new Map<string, NamespaceAttachment>();

    for (const descriptor of descriptors) {
      const current = attachmentsByPath.get(descriptor.path);

      if (current) {
        current.descriptors.push(descriptor);
        continue;
      }

      attachmentsByPath.set(descriptor.path, {
        descriptors: [descriptor],
        namespace: descriptor.path === '/' ? io.of('/') : io.of(descriptor.path),
        path: descriptor.path,
      });
    }

    return Array.from(attachmentsByPath.values());
  }

  private resolveNamespace(path: string): Namespace | undefined {
    return this.attachments.find((attachment) => attachment.path === path)?.namespace;
  }

  private resolveContextNamespace(): Namespace | undefined {
    const namespaceName = this.namespaceContext.getStore();

    if (!namespaceName) {
      return undefined;
    }

    return this.resolveNamespace(namespaceName);
  }

  private resolveRequiredNamespace(namespacePath?: string): Namespace {
    const namespace = namespacePath ? this.resolveNamespace(normalizeGatewayPath(namespacePath)) : this.resolveContextNamespace();

    if (!namespace) {
      throw new Error('Socket.IO room helpers require an explicit namespace outside gateway handler context.');
    }

    return namespace;
  }

  private resolveSocket(socketId: string): Socket | undefined {
    const registered = this.socketRegistry.get(socketId);

    if (registered) {
      return registered;
    }

    for (const attachment of this.attachments) {
      const socket = attachment.namespace.sockets.get(socketId);

      if (socket) {
        this.socketRegistry.set(socketId, socket);
        return socket;
      }
    }

    return undefined;
  }

  private bindNamespaceHandlers(attachment: NamespaceAttachment): void {
    attachment.namespace.on('connection', (socket: Socket) => {
      void this.bindConnectionHandlers(attachment.descriptors, socket);
    });
  }

  private async bindConnectionHandlers(descriptors: WebSocketGatewayDescriptor[], socket: Socket): Promise<void> {
    const request = socket.request as IncomingMessage;
    const resolved = await this.resolveConnectionGateways(descriptors);
    const state = this.createConnectionHandlerState();

    this.socketRegistry.set(socket.id, socket);
    this.attachConnectionListeners(state, resolved, socket, request);
    await this.runConnectHandlers(resolved, socket, request);
    state.handlersReady = true;
    await this.replayBufferedConnectionEvents(state, resolved, socket, request);
  }

  private createConnectionHandlerState(): ConnectionHandlerState {
    return {
      bufferedDisconnect: undefined,
      bufferedMessages: [],
      handlersReady: false,
    };
  }

  private maxPendingMessagesPerSocket(): number {
    return isFinitePositiveInteger(this.moduleOptions.buffer?.maxPendingMessagesPerSocket)
      ? this.moduleOptions.buffer.maxPendingMessagesPerSocket
      : DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
  }

  private attachConnectionListeners(
    state: ConnectionHandlerState,
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: Socket,
    request: IncomingMessage,
  ): void {
    socket.onAny((event: string, ...args: unknown[]) => {
      const ack = typeof args.at(-1) === 'function' ? (args.at(-1) as (...callbackArgs: unknown[]) => void) : undefined;

      if (!state.handlersReady) {
        const limit = this.maxPendingMessagesPerSocket();
        const policy = this.moduleOptions.buffer?.overflowPolicy ?? 'drop-oldest';

        if (state.bufferedMessages.length >= limit) {
          if (policy === 'close') {
            socket.disconnect(true);
            state.bufferedMessages = [];
            this.socketRegistry.delete(socket.id);
            this.logger.warn(
              `Socket.IO connection ${socket.id} exceeded pending message buffer limit (${String(limit)}). Connection terminated.`,
              'SocketIoLifecycleService',
            );
            return;
          }

          if (policy === 'drop-newest') {
            this.logger.warn(
              `Socket.IO connection ${socket.id} dropped an incoming message due to pending buffer limit (${String(limit)}).`,
              'SocketIoLifecycleService',
            );
            return;
          }

          state.bufferedMessages.shift();
          this.logger.warn(
            `Socket.IO connection ${socket.id} dropped the oldest pending message because buffer limit (${String(limit)}) was reached.`,
            'SocketIoLifecycleService',
          );
        }

        state.bufferedMessages.push({
          acknowledgement: ack,
          event,
          payload: extractPayload(args),
        });
        return;
      }

      void this.handleMessage(resolved, socket, request, event, extractPayload(args), ack);
    });

    socket.on('disconnect', (reason: string, description: unknown) => {
      if (!state.handlersReady) {
        state.bufferedDisconnect = { description, reason };
        return;
      }

      void this.handleDisconnect(resolved, socket, reason, description);
      this.socketRegistry.delete(socket.id);
    });
  }

  private async replayBufferedConnectionEvents(
    state: ConnectionHandlerState,
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: Socket,
    request: IncomingMessage,
  ): Promise<void> {
    for (const message of state.bufferedMessages) {
      await this.handleMessage(resolved, socket, request, message.event, message.payload, message.acknowledgement);
    }

    state.bufferedMessages = [];

    if (state.bufferedDisconnect) {
      const disconnectEvent = state.bufferedDisconnect;
      state.bufferedDisconnect = undefined;
      await this.handleDisconnect(resolved, socket, disconnectEvent.reason, disconnectEvent.description);
      this.socketRegistry.delete(socket.id);
      return;
    }

    if (socket.disconnected) {
      this.socketRegistry.delete(socket.id);
    }
  }

  private async resolveConnectionGateways(
    descriptors: WebSocketGatewayDescriptor[],
  ): Promise<Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>> {
    const resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }> = [];

    for (const descriptor of descriptors) {
      const instance = await this.resolveGatewayInstance(descriptor);

      if (instance !== undefined) {
        resolved.push({ descriptor, instance });
      }
    }

    return resolved;
  }

  private async runConnectHandlers(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: Socket,
    request: IncomingMessage,
  ): Promise<void> {
    for (const { descriptor, instance } of resolved) {
      await this.runHandlers(instance, descriptor, 'connect', socket, request);
    }
  }

  private async handleMessage(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: Socket,
    request: IncomingMessage,
    event: string,
    payload: unknown,
    acknowledgement?: (...callbackArgs: unknown[]) => void,
  ): Promise<void> {
    for (const { descriptor, instance } of resolved) {
      const handlers = this.selectMessageHandlers(descriptor, event);

      for (const handler of handlers) {
        await this.invokeGatewayMethod(instance, descriptor, handler, [payload, socket, request, acknowledgement]);
      }
    }
  }

  private selectMessageHandlers(
    descriptor: WebSocketGatewayDescriptor,
    event: string,
  ): WebSocketGatewayHandlerDescriptor[] {
    return descriptor.handlers.filter(
      (handler) => handler.type === 'message' && (handler.event === undefined || handler.event === event),
    );
  }

  private async handleDisconnect(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: Socket,
    reason: string,
    description: unknown,
  ): Promise<void> {
    for (const { descriptor, instance } of resolved) {
      await this.runHandlers(instance, descriptor, 'disconnect', socket, reason, description);
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
        `Socket.IO gateway handler ${descriptor.targetName}.${handler.methodName} is not callable and was skipped.`,
        'SocketIoLifecycleService',
      );
      return;
    }

    try {
      await this.namespaceContext.run(
        descriptor.path,
        async () => await Promise.resolve((value as (this: unknown, ...handlerArgs: unknown[]) => unknown).call(instance, ...args)),
      );
    } catch (error) {
      this.logger.error(
        `Socket.IO gateway handler ${descriptor.targetName}.${handler.methodName} failed.`,
        error,
        'SocketIoLifecycleService',
      );
    }
  }

  private async resolveGatewayInstance(descriptor: WebSocketGatewayDescriptor): Promise<unknown | undefined> {
    try {
      return await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      this.logger.error(
        `Failed to resolve Socket.IO gateway ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'SocketIoLifecycleService',
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
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @WebSocketGateway() but is registered with ${candidate.scope} scope. Socket.IO gateways are registered only for singleton providers.`,
        'SocketIoLifecycleService',
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
      return DEFAULT_SOCKETIO_SHUTDOWN_TIMEOUT_MS;
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
    const io = this.io;

    this.attachments = [];
    this.wired = false;

    if (!io) {
      this.socketRegistry.clear();
      return;
    }

    try {
      await this.closeServerWithTimeout(io, this.resolveShutdownTimeoutMs());
    } catch (error) {
      this.logger.error(
        `Failed to close Socket.IO server within ${String(this.resolveShutdownTimeoutMs())}ms.`,
        error,
        'SocketIoLifecycleService',
      );
    } finally {
      this.io = undefined;
      this.socketRegistry.clear();
    }
  }

  private closeServerWithTimeout(io: Server, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new Error(`Timed out while closing Socket.IO server after ${String(timeoutMs)}ms.`));
      }, timeoutMs);

      io.close(() => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
