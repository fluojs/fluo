import { createServer } from 'node:http';
import { URL } from 'node:url';

import {
  createCorsMiddleware,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type MiddlewareLike,
} from '@konekti/http';

import { bootstrapApplication } from './bootstrap.js';
import { createConsoleApplicationLogger } from './logger.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from './types.js';

export interface NodeHttpAdapterOptions {
  port?: number;
  retryDelayMs?: number;
  retryLimit?: number;
}

export type NodeApplicationSignal = 'SIGINT' | 'SIGTERM';

export interface BootstrapNodeApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  cors?: false | CorsOptions;
  logger?: ApplicationLogger;
  middleware?: MiddlewareLike[];
  port?: number;
  retryDelayMs?: number;
  retryLimit?: number;
}

export interface RunNodeApplicationOptions extends BootstrapNodeApplicationOptions {
  shutdownSignals?: false | readonly NodeApplicationSignal[];
}

export class NodeHttpApplicationAdapter implements HttpApplicationAdapter {
  private server?: import('node:http').Server;

  constructor(
    private readonly port: number,
    private readonly retryDelayMs = 150,
    private readonly retryLimit = 20,
  ) {}

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.server = createServer(async (request, response) => {
      const frameworkRequest = await createFrameworkRequest(request, response);
      const frameworkResponse = createFrameworkResponse(response);

      await dispatcher.dispatch(frameworkRequest, frameworkResponse);

      if (!frameworkResponse.committed) {
        await frameworkResponse.send(undefined);
      }
    });

    const server = this.server;

    if (!server) {
      throw new Error('Adapter server was not created before listen().');
    }

    await new Promise<void>((resolve, reject) => {
      const tryListen = (attempt: number) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);

          if (error.code === 'EADDRINUSE' && attempt < this.retryLimit) {
            setTimeout(() => {
              tryListen(attempt + 1);
            }, this.retryDelayMs);
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
        server.listen(this.port);
      };

      tryListen(0);
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

export function createNodeHttpAdapter(options: NodeHttpAdapterOptions = {}): HttpApplicationAdapter {
  return new NodeHttpApplicationAdapter(
    resolveNodePort(options.port),
    options.retryDelayMs,
    options.retryLimit,
  );
}

export async function bootstrapNodeApplication(
  rootModule: ModuleType,
  options: BootstrapNodeApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();

  return bootstrapApplication({
    ...options,
    adapter: createNodeHttpAdapter(options),
    logger,
    middleware: createNodeMiddleware(options),
    rootModule,
  });
}

export async function runNodeApplication(
  rootModule: ModuleType,
  options: RunNodeApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  const app = await bootstrapNodeApplication(rootModule, {
    ...options,
    logger,
  });
  const port = resolveNodePort(options.port);

  try {
    await app.listen();
    logger.log(`Listening on http://localhost:${String(port)}`, 'KonektiFactory');
  } catch (error) {
    logger.error('Failed to start application.', error, 'KonektiFactory');

    if (app.state !== 'closed') {
      await app.close('bootstrap-failed');
    }

    throw error;
  }

  registerShutdownSignals(app, logger, options.shutdownSignals ?? defaultShutdownSignals(options.mode));

  return app;
}

function createFrameworkResponse(response: import('node:http').ServerResponse): FrameworkResponse {
  return {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      void this.send(undefined);
    },
    send(body) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      if (!response.hasHeader('Content-Type')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
      }

      response.end(body === undefined ? '' : JSON.stringify(body));
      this.committed = true;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      this.headers[name] = value;
    },
    setStatus(code) {
      response.statusCode = code;
    },
    statusCode: 200,
  };
}

async function createFrameworkRequest(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
): Promise<FrameworkRequest> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
  );

  return {
    body: await readRequestBody(request),
    cookies: {},
    headers,
    method: request.method ?? 'GET',
    params: {},
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    raw: request,
    signal: createRequestSignal(request, response),
    url: url.pathname + url.search,
  };
}

function createNodeMiddleware(options: BootstrapNodeApplicationOptions): MiddlewareLike[] {
  const middleware = [...(options.middleware ?? [])];

  if (options.cors !== false) {
    middleware.unshift(createCorsMiddleware(options.cors ?? createDefaultCorsOptions()));
  }

  return middleware;
}

function createDefaultCorsOptions(): CorsOptions {
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';

  return {
    allowHeaders: ['Authorization', 'Content-Type'],
    allowOrigin: corsOrigin === '*'
      ? '*'
      : corsOrigin
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
    exposeHeaders: ['X-Request-Id'],
  };
}

function createRequestSignal(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
): AbortSignal {
  const controller = new AbortController();
  const abort = (reason: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  };

  request.once('aborted', () => {
    abort('Request aborted before response commit.');
  });
  response.once('close', () => {
    if (!response.writableEnded) {
      abort('Response closed before response commit.');
    }
  });

  return controller.signal;
}

function defaultShutdownSignals(mode: RunNodeApplicationOptions['mode']): false | readonly NodeApplicationSignal[] {
  return mode === 'test' ? false : ['SIGINT', 'SIGTERM'];
}

function registerShutdownSignals(
  app: Application,
  logger: ApplicationLogger,
  signals: false | readonly NodeApplicationSignal[],
): void {
  if (signals === false) {
    return;
  }

  for (const signal of signals) {
    process.once(signal, () => {
      void closeFromSignal(app, logger, signal);
    });
  }
}

async function closeFromSignal(app: Application, logger: ApplicationLogger, signal: NodeApplicationSignal): Promise<void> {
  if (app.state === 'closed') {
    process.exit(0);
  }

  try {
    await app.close(signal);
    process.exit(0);
  } catch (error) {
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exit(1);
  }
}

async function readRequestBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const bodyText = Buffer.concat(chunks).toString('utf8');

  if (bodyText.length === 0) {
    return undefined;
  }

  const contentType = request.headers['content-type'];
  const primaryContentType = Array.isArray(contentType) ? contentType[0] : contentType;

  if (typeof primaryContentType === 'string' && primaryContentType.includes('application/json')) {
    return JSON.parse(bodyText) as unknown;
  }

  return bodyText;
}

function resolveNodePort(value: number | undefined): number {
  const port = value ?? Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${String(value ?? process.env.PORT ?? 3000)}.`);
  }

  return port;
}
