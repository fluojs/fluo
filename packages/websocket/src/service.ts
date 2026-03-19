import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Provider, Container } from '@konekti/di';
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
import type { HttpApplicationAdapter } from '@konekti/http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { getWebSocketGatewayMetadata, getWebSocketHandlerMetadataEntries } from './metadata.js';
import type { WebSocketGatewayDescriptor, WebSocketGatewayHandlerDescriptor } from './types.js';

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

interface NodeUpgradeServer {
  off(event: 'upgrade', listener: NodeUpgradeListener): this;
  on(event: 'upgrade', listener: NodeUpgradeListener): this;
}

type NodeUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

type ParsedWebSocketMessage = {
  event?: string;
  payload: unknown;
};

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
  if (socket.destroyed) {
    return;
  }

  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER])
export class WebSocketGatewayLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
  private attachments: GatewayAttachment[] = [];
  private shutdownPromise: Promise<void> | undefined;
  private upgradeListener: NodeUpgradeListener | undefined;
  private upgradeServer: NodeUpgradeServer | undefined;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly adapter: HttpApplicationAdapter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.upgradeListener) {
      return;
    }

    const descriptors = this.discoverGatewayDescriptors();

    if (descriptors.length === 0) {
      return;
    }

    const upgradeServer = this.resolveUpgradeServer();
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

    for (const attachment of attachmentsByPath.values()) {
      attachment.server.on('connection', (socket: WebSocket, request: IncomingMessage) => {
        void this.bindConnectionHandlers(attachment.descriptors, socket, request);
      });
    }

    const listener: NodeUpgradeListener = (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const targetPath = normalizeGatewayPath(url.pathname);
      const attachment = attachmentsByPath.get(targetPath);

      if (!attachment) {
        rejectUpgradeRequest(socket);
        return;
      }

      attachment.server.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        attachment.server.emit('connection', websocket, request);
      });
    };

    upgradeServer.on('upgrade', listener);
    this.upgradeServer = upgradeServer;
    this.upgradeListener = listener;
    this.attachments = Array.from(attachmentsByPath.values());
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
    const resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }> = [];

    for (const descriptor of descriptors) {
      const instance = await this.resolveGatewayInstance(descriptor);

      if (instance !== undefined) {
        resolved.push({ descriptor, instance });
      }
    }

    socket.on('message', (data: RawData) => {
      void this.handleMessage(resolved, socket, request, data);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      void this.handleDisconnect(resolved, socket, code, reason);
    });

    await Promise.all(
      resolved.map(async ({ descriptor, instance }) => {
        await this.runHandlers(instance, descriptor, 'connect', socket, request);
      }),
    );
  }

  private async handleMessage(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: WebSocket,
    request: IncomingMessage,
    data: RawData,
  ): Promise<void> {
    const parsed = parseIncomingMessage(data);

    await Promise.all(
      resolved.map(async ({ descriptor, instance }) => {
        const handlers = descriptor.handlers.filter(
          (handler) =>
            handler.type === 'message' &&
            (handler.event === undefined || handler.event === parsed.event),
        );

        for (const handler of handlers) {
          await this.invokeGatewayMethod(instance, descriptor, handler, [parsed.payload, socket, request]);
        }
      }),
    );
  }

  private async handleDisconnect(
    resolved: Array<{ descriptor: WebSocketGatewayDescriptor; instance: unknown }>,
    socket: WebSocket,
    code: number,
    reason: Buffer,
  ): Promise<void> {
    await Promise.all(
      resolved.map(async ({ descriptor, instance }) => {
        await this.runHandlers(instance, descriptor, 'disconnect', socket, code, reason.toString('utf8'));
      }),
    );
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

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @WebSocketGateway() but is registered with ${candidate.scope} scope. WebSocket gateways are registered only for singleton providers.`,
          'WebSocketGatewayLifecycleService',
        );
        continue;
      }

      if (seenTargets.has(candidate.targetType)) {
        continue;
      }

      seenTargets.add(candidate.targetType);
      descriptors.push({
        handlers: getWebSocketHandlerMetadataEntries(candidate.targetType.prototype).map((entry) => ({
          event: entry.metadata.event,
          methodKey: entry.propertyKey,
          methodName: methodKeyToName(entry.propertyKey),
          type: entry.metadata.type,
        })),
        moduleName: candidate.moduleName,
        path: normalizeGatewayPath(gatewayMetadata.path),
        targetName: candidate.targetType.name,
        token: candidate.token,
      });
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

  private async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.shutdownPromise = (async () => {
      if (this.upgradeServer && this.upgradeListener) {
        this.upgradeServer.off('upgrade', this.upgradeListener);
      }

      this.upgradeServer = undefined;
      this.upgradeListener = undefined;

      const attachments = this.attachments.splice(0);

      await Promise.all(
        attachments.map(async (attachment) => {
          for (const client of attachment.server.clients) {
            client.terminate();
          }

          attachment.server.close();
        }),
      );
    })();

    await this.shutdownPromise;
  }
}
