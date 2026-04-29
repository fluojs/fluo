import { createServer as createHttpServer, type RequestListener, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type ServerOptions as HttpsServerOptions } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';

import {
  createServerBackedHttpAdapterRealtimeCapability,
  type CorsOptions,
  type Dispatcher,
  type HttpApplicationAdapter,
  type MiddlewareLike,
  type SecurityHeadersOptions,
} from '@fluojs/http';

import {
  bootstrapHttpAdapterApplication,
  runHttpAdapterApplication,
} from '../http-adapter-shared.js';
import {
  createNodeResponseCompression,
  compressNodeResponse,
} from './internal-node-compression.js';
import {
  createDeferredFrameworkRequest,
  NodeRequestPayloadTooLargeException,
  createRequestSignal,
  materializeFrameworkRequestBody,
  resolveRequestIdFromHeaders,
} from './internal-node-request.js';
import {
  createFrameworkResponse,
  type MutableFrameworkResponse,
  writeNodeAdapterErrorResponse,
} from './internal-node-response.js';
import {
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
  registerShutdownSignals,
} from './internal-node-shutdown.js';
import type { MultipartOptions, UploadedFile } from '../multipart.js';
import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from '../adapters/request-response-factory.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from '../types.js';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

/**
 * Describes the node http adapter options contract.
 */
export interface NodeHttpAdapterOptions {
  host?: string;
  https?: HttpsServerOptions;
  maxBodySize?: number;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  shutdownTimeoutMs?: number;
}

/**
 * Defines the node application signal type.
 */
export type NodeApplicationSignal = 'SIGINT' | 'SIGTERM';

/**
 * Defines the cors input type.
 */
export type CorsInput = false | string | string[] | CorsOptions;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Describes the bootstrap node application options contract.
 */
export interface BootstrapNodeApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  compression?: boolean;
  cors?: CorsInput;
  globalPrefix?: string;
  globalPrefixExclude?: readonly string[];
  host?: string;
  https?: HttpsServerOptions;
  logger?: ApplicationLogger;
  maxBodySize?: number;
  middleware?: MiddlewareLike[];
  multipart?: MultipartOptions;
  port?: number;
  rawBody?: boolean;
  retryDelayMs?: number;
  retryLimit?: number;
  securityHeaders?: false | SecurityHeadersOptions;
  shutdownTimeoutMs?: number;
}

/**
 * Describes the run node application options contract.
 */
export interface RunNodeApplicationOptions extends BootstrapNodeApplicationOptions {
  forceExitTimeoutMs?: number;
  shutdownSignals?: false | readonly NodeApplicationSignal[];
}

interface NodeListenTarget {
  bindTarget: string;
  url: string;
}

interface NodeListenRetryOptions {
  host: string | undefined;
  port: number;
  retryDelayMs: number;
  retryLimit: number;
}

type NodeServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
type NodeRequestListener = RequestListener;

/**
 * Represents the node http application adapter.
 */
export class NodeHttpApplicationAdapter implements HttpApplicationAdapter {
  private readonly server: NodeServer;
  private dispatcher?: Dispatcher;
  private readonly requestResponseFactory: RequestResponseFactory<
    import('node:http').IncomingMessage,
    import('node:http').ServerResponse,
    MutableFrameworkResponse
  >;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly port: number,
    private readonly host: string | undefined,
    private readonly retryDelayMs = 150,
    private readonly retryLimit = 20,
    compression = false,
    private readonly httpsOptions: HttpsServerOptions | undefined,
    multipartOptions?: MultipartOptions,
    maxBodySize = 1 * 1024 * 1024,
    preserveRawBody = false,
    private readonly shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {
    this.requestResponseFactory = createNodeRequestResponseFactory(
      compression,
      multipartOptions,
      maxBodySize,
      preserveRawBody,
    );
    this.server = createNodeServer(this.httpsOptions, (request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  getServer(): NodeServer {
    return this.server;
  }

  getRealtimeCapability() {
    return createServerBackedHttpAdapterRealtimeCapability(this.server);
  }

  getListenTarget(): NodeListenTarget {
    return resolveNodeListenTarget(this.server.address() ?? null, this.port, this.host, this.httpsOptions !== undefined);
  }

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    await listenNodeServerWithRetry(this.server, {
      host: this.host,
      port: this.port,
      retryDelayMs: this.retryDelayMs,
      retryLimit: this.retryLimit,
    });
  }

  async close(): Promise<void> {
    const server = this.server;

    if (!server.listening) {
      this.dispatcher = undefined;
      return;
    }

    await closeNodeServerWithDrain(server, this.sockets, this.shutdownTimeoutMs);

    this.dispatcher = undefined;
  }

  private async handleRequest(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    await dispatchWithRequestResponseFactory({
      dispatcher: this.dispatcher,
      dispatcherNotReadyMessage: 'Node HTTP adapter received a request before dispatcher binding completed.',
      factory: this.requestResponseFactory,
      rawRequest: request,
      rawResponse: response,
    });
  }
}

function createNodeRequestResponseFactory(
  compression: boolean,
  multipartOptions: MultipartOptions | undefined,
  maxBodySize: number,
  preserveRawBody: boolean,
): RequestResponseFactory<
  import('node:http').IncomingMessage,
  import('node:http').ServerResponse,
  MutableFrameworkResponse
> {
  return {
    async createRequest(request, signal) {
      return createDeferredFrameworkRequest(
        request,
        signal,
        multipartOptions,
        maxBodySize,
        preserveRawBody,
      );
    },
    materializeRequest(request) {
      return materializeFrameworkRequestBody(request);
    },
    createRequestSignal(response) {
      return createRequestSignal(response);
    },
    createResponse(response, request) {
      return createFrameworkResponse(
        response,
        compression
          ? () => createNodeResponseCompression(response, request.headers['accept-encoding'] as string | undefined)
          : undefined,
      );
    },
    resolveRequestId(request) {
      return resolveRequestIdFromHeaders(request.headers);
    },
    async writeErrorResponse(error, response, requestId) {
      if (error instanceof NodeRequestPayloadTooLargeException) {
        error.prepareResponse((response as MutableFrameworkResponse & { raw: ServerResponse }).raw);
      }

      await writeNodeAdapterErrorResponse(error, response, requestId);
    },
  };
}

/**
 * Create node http adapter.
 *
 * @param options The options.
 * @param compression The compression.
 * @param multipartOptions The multipart options.
 * @returns The create node http adapter result.
 */
export function createNodeHttpAdapter(options: NodeHttpAdapterOptions = {}, compression = false, multipartOptions?: MultipartOptions): HttpApplicationAdapter {
  return new NodeHttpApplicationAdapter(
    resolveNodePort(options.port),
    options.host,
    options.retryDelayMs,
    options.retryLimit,
    compression,
    options.https,
    multipartOptions,
    resolveNodeMaxBodySize(options.maxBodySize),
    options.rawBody,
    options.shutdownTimeoutMs,
  );
}

/**
 * Bootstrap node application.
 *
 * @param rootModule The root module.
 * @param options The options.
 * @returns The bootstrap node application result.
 */
export async function bootstrapNodeApplication(
  rootModule: ModuleType,
  options: BootstrapNodeApplicationOptions,
): Promise<Application> {
  return bootstrapHttpAdapterApplication(
    rootModule,
    options,
    createNodeHttpAdapter(options, options.compression ?? false, options.multipart),
  );
}

/**
 * Run node application.
 *
 * @param rootModule The root module.
 * @param options The options.
 * @returns The run node application result.
 */
export async function runNodeApplication(
  rootModule: ModuleType,
  options: RunNodeApplicationOptions,
): Promise<Application> {
  const adapter = createNodeHttpAdapter(options, options.compression ?? false, options.multipart) as NodeHttpApplicationAdapter;
  return runHttpAdapterApplication(rootModule, {
    ...options,
    shutdownRegistration: createNodeShutdownSignalRegistration(
      options.shutdownSignals ?? defaultNodeShutdownSignals(),
    ),
  }, adapter);
}

export {
  compressNodeResponse,
  createNodeResponseCompression,
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
  registerShutdownSignals,
};

function createNodeServer(
  httpsOptions: HttpsServerOptions | undefined,
  handler: NodeRequestListener,
): NodeServer {
  return httpsOptions ? createHttpsServer(httpsOptions, handler) : createHttpServer(handler);
}

function listenNodeServerWithRetry(server: NodeServer, options: NodeListenRetryOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tryListen = (attempt: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);

        if (error.code === 'EADDRINUSE' && attempt < options.retryLimit) {
          scheduleNodeListenRetry(server, attempt, options.retryDelayMs, tryListen);
          return;
        }

        reject(error);
      };

      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: options.host, port: options.port });
    };

    tryListen(0);
  });
}

function scheduleNodeListenRetry(
  server: NodeServer,
  attempt: number,
  retryDelayMs: number,
  tryListen: (attempt: number) => void,
): void {
  server.close(() => {
    setTimeout(() => {
      tryListen(attempt + 1);
    }, retryDelayMs);
  });
}

function closeNodeServerWithDrain(
  server: NodeServer,
  sockets: ReadonlySet<Socket>,
  shutdownTimeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      forceCloseConnections(server, sockets);
    }, shutdownTimeoutMs);

    const finish = (error?: Error | null) => {
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
    };

    server.close((error) => {
      finish(error);
    });

    closeIdleConnections(server);
  });
}

function resolveNodeListenTarget(
  address: AddressInfo | string | null,
  port: number,
  host: string | undefined,
  useHttps: boolean,
): NodeListenTarget {
  const protocol = useHttps ? 'https' : 'http';
  const resolvedPort = typeof address === 'object' && address !== null ? address.port : port;
  const bindHost = typeof address === 'object' && address !== null ? address.address : host ?? '0.0.0.0';
  const publicHost = resolvePublicHost(host ?? bindHost);
  const bindTarget = `${formatHostForAuthority(bindHost)}:${String(resolvedPort)}`;
  const url = `${protocol}://${formatHostForAuthority(publicHost)}:${String(resolvedPort)}`;

  return { bindTarget, url };
}

function resolvePublicHost(host: string): string {
  return isWildcardHost(host) ? 'localhost' : host;
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

function formatHostForAuthority(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function closeIdleConnections(server: import('node:http').Server): void {
  server.closeIdleConnections?.();
}

function forceCloseConnections(server: import('node:http').Server, sockets: ReadonlySet<Socket>): void {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
    return;
  }

  for (const socket of sockets) {
    socket.destroy();
  }
}

function resolveNodePort(value: number | undefined): number {
  const port = value ?? 3000;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${String(value ?? 3000)}.`);
  }

  return port;
}

function resolveNodeMaxBodySize(value: number | undefined): number {
  const maxBodySize = value ?? 1 * 1024 * 1024;

  if (!Number.isInteger(maxBodySize) || maxBodySize < 0) {
    throw new Error(
      `Invalid maxBodySize value: ${String(value ?? 1 * 1024 * 1024)}. Expected a non-negative integer number of bytes.`,
    );
  }

  return maxBodySize;
}
