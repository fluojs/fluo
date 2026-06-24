import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { FrameworkRequest, HttpApplicationAdapter } from '@fluojs/http';
import type {
  ExecutionArgs,
  GraphQLError as GraphQLErrorType,
  execute as executeGraphql,
  subscribe as subscribeGraphql,
} from 'graphql';
import { handleProtocols, type CompleteMessage, type Context as GraphqlWsServerContext, type SubscribeMessage } from 'graphql-ws';
import { useServer, type Extra as GraphqlWsExtra } from 'graphql-ws/lib/use/ws';
import { WebSocketServer, type WebSocket } from 'ws';

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

export interface GraphqlNodeWebSocketSubscribeRequest {
  connectionParams?: Record<string, unknown>;
  operationId: string;
  payload: GraphqlSubscribePayload;
  request: FrameworkRequest;
  socket: object;
}

export interface GraphqlNodeWebSocketTransport {
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

export async function createNodeGraphqlWebSocketTransport(
  options: GraphqlNodeWebSocketTransportOptions,
): Promise<GraphqlNodeWebSocketTransport> {
  const upgradeServer = resolveUpgradeServer(options.adapter);
  const websocketServer = new WebSocketServer({
    handleProtocols: (protocols: Set<string>) => handleProtocols(protocols),
    maxPayload: options.limits?.maxPayloadBytes ?? 0,
    noServer: true,
  });
  const upgradeListener = createUpgradeListener(websocketServer, options.limits);
  const websocketDisposable = useServer(
    {
      connectionInitWaitTimeout: options.connectionInitWaitTimeoutMs,
      execute: options.execute,
      onComplete: async (context: GraphqlWebSocketContext, message: CompleteMessage) => {
        await options.onComplete(context.extra.socket, message.id);
      },
      onDisconnect: async (context: GraphqlWebSocketContext) => {
        await options.onDisconnect(context.extra.socket);
      },
      onSubscribe: async (context: GraphqlWebSocketContext, message: SubscribeMessage) =>
        options.onSubscribe(createSubscribeRequest(context, message)),
      subscribe: options.subscribe,
    },
    websocketServer,
    options.keepAliveMs,
  );

  upgradeServer.on('upgrade', upgradeListener);

  return {
    async dispose() {
      let disposeError: unknown;

      upgradeServer.off('upgrade', upgradeListener);

      for (const client of websocketServer.clients) {
        client.terminate();
      }

      try {
        await websocketDisposable.dispose();
      } catch (error) {
        disposeError = error;
      }

      try {
        await closeWebSocketServer(websocketServer);
      } catch (error) {
        disposeError ??= error;
      }

      if (disposeError instanceof Error) {
        throw disposeError;
      }

      if (disposeError !== undefined) {
        throw new Error(String(disposeError));
      }
    },
  };
}
