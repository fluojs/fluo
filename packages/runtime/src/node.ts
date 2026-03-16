import { createServer } from 'node:http';
import { URL } from 'node:url';

import {
  BadRequestException,
  createCorsMiddleware,
  type CorsOptions,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type MiddlewareLike,
} from '@konekti/http';

import { bootstrapApplication } from './bootstrap.js';
import { compressResponse } from './compression.js';
import { createConsoleApplicationLogger } from './logger.js';
import { parseMultipart, type MultipartOptions, type UploadedFile } from './multipart.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from './types.js';

declare module '@konekti/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
  }
}

export interface NodeHttpAdapterOptions {
  maxBodySize?: number;
  port?: number;
  retryDelayMs?: number;
  retryLimit?: number;
}

export type NodeApplicationSignal = 'SIGINT' | 'SIGTERM';

export interface BootstrapNodeApplicationOptions extends Omit<CreateApplicationOptions, 'adapter' | 'logger' | 'middleware'> {
  compression?: boolean;
  cors?: false | CorsOptions;
  logger?: ApplicationLogger;
  maxBodySize?: number;
  middleware?: MiddlewareLike[];
  multipart?: MultipartOptions;
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
    private readonly compression = false,
    private readonly multipartOptions?: MultipartOptions,
    private readonly maxBodySize = 1 * 1024 * 1024,
  ) {}

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.server = createServer(async (request, response) => {
      const signal = createRequestSignal(request, response);
      const frameworkRequest = await createFrameworkRequest(request, signal, this.multipartOptions, this.maxBodySize);
      const frameworkResponse = createFrameworkResponse(response, this.compression ? request.headers['accept-encoding'] as string | undefined : undefined);

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
            server.close(() => {
              setTimeout(() => {
                tryListen(attempt + 1);
              }, this.retryDelayMs);
            });
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

export function createNodeHttpAdapter(options: NodeHttpAdapterOptions = {}, compression = false, multipartOptions?: MultipartOptions): HttpApplicationAdapter {
  return new NodeHttpApplicationAdapter(
    resolveNodePort(options.port),
    options.retryDelayMs,
    options.retryLimit,
    compression,
    multipartOptions,
    options.maxBodySize,
  );
}

export async function bootstrapNodeApplication(
  rootModule: ModuleType,
  options: BootstrapNodeApplicationOptions,
): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();

  return bootstrapApplication({
    ...options,
    adapter: createNodeHttpAdapter(options, options.compression ?? false, options.multipart),
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

function createFrameworkResponse(response: import('node:http').ServerResponse, acceptEncoding?: string): FrameworkResponse {
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

      const existingContentType = response.getHeader('Content-Type');
      const serialized = serializeResponseBody(
        body,
        typeof existingContentType === 'string' ? existingContentType : undefined,
      );

      if (!response.hasHeader('Content-Type') && serialized.defaultContentType) {
        response.setHeader('Content-Type', serialized.defaultContentType);
      }

      const contentType = response.getHeader('Content-Type') as string | undefined;
      const payload = typeof serialized.payload === 'string'
        ? Buffer.from(serialized.payload, 'utf8')
        : serialized.payload;

      if (acceptEncoding && payload.byteLength >= 256) {
        this.committed = true;
        void compressResponse(response, payload, acceptEncoding, contentType);
        return;
      }

      response.end(payload);
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

function serializeResponseBody(
  body: unknown,
  contentType?: string,
): { defaultContentType?: string; payload: Buffer | string } {
  if (body === undefined) {
    return { payload: '' };
  }

  if (Buffer.isBuffer(body)) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: body,
    };
  }

  if (body instanceof Uint8Array) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (typeof body === 'string') {
    return {
      defaultContentType: isJsonContentType(contentType) ? undefined : 'text/plain; charset=utf-8',
      payload: isJsonContentType(contentType) ? JSON.stringify(body) : body,
    };
  }

  return {
    defaultContentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(body),
  };
}

function isJsonContentType(contentType: string | undefined): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

async function createFrameworkRequest(
  request: import('node:http').IncomingMessage,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = 1 * 1024 * 1024,
): Promise<FrameworkRequest> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
  );

  const contentType = headers['content-type'];
  const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/form-data');

  let body: unknown;
  let files: UploadedFile[] | undefined;

  if (isMultipart) {
    const result = await parseMultipart(request, multipartOptions);

    body = result.fields;
    files = result.files;
  } else {
    body = await readRequestBody(request, headers['content-type'], maxBodySize);
  }

  const frameworkRequest: FrameworkRequest = {
    body,
    cookies: {},
    headers,
    method: request.method ?? 'GET',
    params: {},
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    raw: request,
    signal,
    url: url.pathname + url.search,
  };

  if (files) {
    frameworkRequest.files = files;
  }

  return frameworkRequest;
}

function createNodeMiddleware(options: BootstrapNodeApplicationOptions): MiddlewareLike[] {
  const middleware = [...(options.middleware ?? [])];

  if (options.cors !== false) {
    middleware.unshift(createCorsMiddleware(options.cors ?? createDefaultCorsOptions()));
  }

  return middleware;
}

/**
 * `cors` 옵션을 생략했을 때 사용되는 기본 CORS 설정을 반환한다.
 *
 * @remarks
 * 이 함수는 DI 컨테이너가 초기화되기 전, 즉 `ConfigService`가 생성되기 전에 호출된다.
 * 따라서 `CORS_ORIGIN` 값은 `@konekti/config`의 우선순위 병합(defaults < .env 파일 < process.env < runtimeOverrides)을
 * 우회하여 `process.env.CORS_ORIGIN`에서 직접 읽는다.
 * `runtimeOverrides`로 `CORS_ORIGIN`을 제어해야 하는 경우, `cors` 옵션에 `CorsOptions`를 명시적으로 전달할 것.
 */
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

async function readRequestBody(request: import('node:http').IncomingMessage, contentType: string | string[] | undefined, maxBodySize = 1 * 1024 * 1024): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const buf: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalSize += buf.byteLength;

    if (totalSize > maxBodySize) {
      throw new BadRequestException('Request body exceeds the size limit.');
    }

    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const bodyText = Buffer.concat(chunks).toString('utf8');

  if (bodyText.length === 0) {
    return undefined;
  }

  const primaryContentType = Array.isArray(contentType) ? contentType[0] : contentType;

  if (typeof primaryContentType === 'string' && primaryContentType.includes('application/json')) {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      throw new BadRequestException('Request body contains invalid JSON.');
    }
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
