import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { FrameworkRequest, HttpApplicationAdapter } from '@fluojs/http';
import type {
  ExecutionArgs,
  execute as executeGraphql,
  GraphQLError as GraphQLErrorType,
  subscribe as subscribeGraphql,
} from 'graphql';
import { type CompleteMessage, type Context as GraphqlWsServerContext, handleProtocols, type SubscribeMessage } from 'graphql-ws';
import { type Extra as GraphqlWsExtra, useServer } from 'graphql-ws/lib/use/ws';
import { type WebSocket, WebSocketServer } from 'ws';

import { isGraphqlPath } from '../transport/transport.js';

type NodeUpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

type GraphqlWebSocketContext = GraphqlWsServerContext<Record<string, unknown>, GraphqlWsExtra>;

interface NodeUpgradeServer {
  off(event: 'upgrade', listener: NodeUpgradeListener): this;
  on(event: 'upgrade', listener: NodeUpgradeListener): this;
}

interface GraphqlNodeWebSocketLimits {
  maxConnections: number;
  maxOperationsPerConnection: number;
  maxPayloadBytes: number;
}

interface GraphqlSubscribePayload {
  operationName?: string | null;
  query: string;
  variables?: Record<string, unknown> | null;
}

/**
 * Describes a GraphQL-over-WebSocket subscription forwarded to application hooks.
 */
export interface GraphqlNodeWebSocketSubscribeRequest {
  connectionParams?: Record<string, unknown>;
  operationId: string;
  payload: GraphqlSubscribePayload;
  request: FrameworkRequest;
  socket: object;
}

/**
 * Represents a registered Node GraphQL WebSocket transport.
 */
export interface GraphqlNodeWebSocketTransport {
  /**
   * Releases websocket listeners, clients, and GraphQL protocol resources.
   *
   * @returns A promise that resolves when cleanup completes or rejects with all current cleanup failures.
   */
  dispose(): Promise<void>;
}

interface GraphqlNodeWebSocketTransportOptions {
  adapter: HttpApplicationAdapter;
  connectionInitWaitTimeoutMs?: number;
  execute: typeof executeGraphql;
  keepAliveMs?: number;
  limits?: GraphqlNodeWebSocketLimits;
  onComplete: (socketKey: object, operationId: string) => Promise<void> | void;
  onDisconnect: (socketKey: object) => Promise<void> | void;
  onSubscribe: (request: GraphqlNodeWebSocketSubscribeRequest) => Promise<ExecutionArgs | readonly GraphQLErrorType[]>;
  subscribe: typeof subscribeGraphql;
}

function hasNodeUpgradeServer(value: unknown): value is NodeUpgradeServer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const server = value as { off?: unknown; on?: unknown };

  return typeof server.on === 'function' && typeof server.off === 'function';
}

function isConnectionParamsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildFrameworkRequestFromIncomingMessage(request: IncomingMessage): FrameworkRequest {
  const requestUrl = new URL(request.url ?? '/graphql', 'http://localhost');

  return {
    cookies: {},
    headers: request.headers,
    method: request.method ?? 'GET',
    params: {},
    path: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    raw: request,
    url: requestUrl.pathname + requestUrl.search,
  };
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error?.message === 'The server is not running') {
        resolve();
        return;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function collectCleanupError(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    errors.push(...error.errors);
    return;
  }

  errors.push(error);
}

function resolveUpgradeServer(adapter: HttpApplicationAdapter): NodeUpgradeServer {
  if (typeof adapter.getServer !== 'function') {
    throw new Error(
      'GraphQL websocket subscriptions require an HTTP adapter with getServer(). Use the Node HTTP adapter or provide a compatible adapter implementation.',
    );
  }

  const server = adapter.getServer();

  if (!hasNodeUpgradeServer(server)) {
    throw new Error(
      'GraphQL websocket subscriptions require adapter.getServer() to return a Node HTTP/S server that supports upgrade listeners.',
    );
  }

  return server;
}

function rejectWebSocketUpgrade(socket: Duplex, statusCode: number, message: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }

  const body = `${message}\n`;
  socket.write(
    [
      `HTTP/1.1 ${String(statusCode)} ${statusCode === 503 ? 'Service Unavailable' : 'Bad Request'}`,
      'Connection: close',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${String(new TextEncoder().encode(body).byteLength)}`,
      '',
      body,
    ].join('\r\n'),
  );
  socket.destroy();
}

function createUpgradeListener(websocketServer: WebSocketServer, limits: GraphqlNodeWebSocketLimits | undefined): NodeUpgradeListener {
  return (request, socket, head) => {
    const targetPath = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (!isGraphqlPath(targetPath)) {
      return;
    }

    if (limits && websocketServer.clients.size >= limits.maxConnections) {
      rejectWebSocketUpgrade(
        socket,
        503,
        'GraphQL websocket connection count exceeds the configured limit.',
      );
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      websocketServer.emit('connection', websocket, request);
    });
  };
}

function createSubscribeRequest(
  context: GraphqlWebSocketContext,
  message: SubscribeMessage,
): GraphqlNodeWebSocketSubscribeRequest {
  return {
    connectionParams: isConnectionParamsRecord(context.connectionParams) ? context.connectionParams : undefined,
    operationId: message.id,
    payload: message.payload,
    request: buildFrameworkRequestFromIncomingMessage(context.extra.request),
    socket: context.extra.socket,
  };
}

/**
 * Registers GraphQL-over-WebSocket upgrade handling for a Node HTTP/S adapter.
 *
 * @param options Transport dependencies and WebSocket lifecycle hooks.
 * @returns A transport that unregisters upgrade handling and disposes WebSocket clients.
 */
export async function createNodeGraphqlWebSocketTransport(
  options: GraphqlNodeWebSocketTransportOptions,
): Promise<GraphqlNodeWebSocketTransport> {
  const upgradeServer = resolveUpgradeServer(options.adapter);
  const disconnectErrors: unknown[] = [];
  const disconnectedSockets = new Set<object>();
  const pendingDisconnects = new Set<Promise<void>>();
  let websocketDisposableDisposed = false;
  let websocketServerClosed = false;
  const websocketServer = new WebSocketServer({
    handleProtocols: (protocols: Set<string>) => handleProtocols(protocols),
    maxPayload: options.limits?.maxPayloadBytes ?? 0,
    noServer: true,
  });
  const upgradeListener = createUpgradeListener(websocketServer, options.limits);
  const trackDisconnect = (socketKey: object) => {
    if (disconnectedSockets.has(socketKey)) {
      return;
    }

    disconnectedSockets.add(socketKey);
    const pendingDisconnect = Promise.resolve(options.onDisconnect(socketKey))
      .catch((error: unknown) => {
        disconnectErrors.push(error);
      })
      .finally(() => {
        pendingDisconnects.delete(pendingDisconnect);
      });
    pendingDisconnects.add(pendingDisconnect);
  };
  const trackConnection = (websocket: WebSocket) => {
    websocket.once('close', () => trackDisconnect(websocket));
  };
  const websocketDisposable = useServer(
    {
      connectionInitWaitTimeout: options.connectionInitWaitTimeoutMs,
      execute: options.execute,
      onComplete: async (context: GraphqlWebSocketContext, message: CompleteMessage) => {
        await options.onComplete(context.extra.socket, message.id);
      },
      onDisconnect: (context: GraphqlWebSocketContext) => {
        trackDisconnect(context.extra.socket);
      },
      onSubscribe: async (context: GraphqlWebSocketContext, message: SubscribeMessage) =>
        options.onSubscribe(createSubscribeRequest(context, message)),
      subscribe: options.subscribe,
    },
    websocketServer,
    options.keepAliveMs,
  );

  websocketServer.on('connection', trackConnection);
  upgradeServer.on('upgrade', upgradeListener);

  return {
    async dispose() {
      const cleanupErrors = disconnectErrors.splice(0, disconnectErrors.length);

      websocketServer.off('connection', trackConnection);
      upgradeServer.off('upgrade', upgradeListener);

      for (const client of websocketServer.clients) {
        client.terminate();
      }

      const disconnectResults = await Promise.allSettled(pendingDisconnects);
      cleanupErrors.push(...disconnectErrors.splice(0, disconnectErrors.length));
      for (const result of disconnectResults) {
        if (result.status === 'rejected') {
          collectCleanupError(cleanupErrors, result.reason);
        }
      }

      if (!websocketDisposableDisposed) {
        try {
          await websocketDisposable.dispose();
          websocketDisposableDisposed = true;
        } catch (error) {
          collectCleanupError(cleanupErrors, error);
        }
      }

      if (!websocketServerClosed) {
        try {
          await closeWebSocketServer(websocketServer);
          websocketServerClosed = true;
        } catch (error) {
          collectCleanupError(cleanupErrors, error);
        }
      }

      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }

      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, 'Failed to dispose GraphQL websocket transport resources.');
      }
    },
  };
}
