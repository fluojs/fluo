import {
  BadRequestException,
  createErrorResponse,
  HttpException,
  InternalServerErrorException,
  PayloadTooLargeException,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@fluojs/http';

import {
  parseMultipart,
  type MultipartOptions,
  type UploadedFile,
} from './multipart.js';
import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from './adapters/request-response-factory.js';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const REQUEST_BODY_LIMIT_MESSAGE = 'Request body exceeds the size limit.';

/**
 * Configures Web request parsing, multipart handling, and raw body preservation.
 */
export interface CreateWebRequestResponseFactoryOptions {
  maxBodySize?: number;
  multipart?: MultipartOptions;
  rawBody?: boolean;
}

/**
 * Describes a dispatched Web request and the runtime options used to handle it.
 */
export interface DispatchWebRequestOptions extends CreateWebRequestResponseFactoryOptions {
  dispatcher?: Dispatcher;
  dispatcherNotReadyMessage?: string;
  request: Request;
}

/**
 * Represents a framework response that can be materialized as a native Web `Response`.
 */
export interface WebFrameworkResponse extends FrameworkResponse {
  toResponse(): Response;
}

export { parseMultipart } from './multipart.js';

interface WebFrameworkResponseStream {
  readonly closed: boolean;
  close(): void;
  flush?(): void;
  onClose?(listener: () => void): (() => void) | void;
  waitForDrain?(): Promise<void>;
  write(chunk: string | Uint8Array): boolean;
}

type WebFrameworkRequest = FrameworkRequest & {
  files?: UploadedFile[];
  rawBody?: Uint8Array;
};

class WebResponseStream implements WebFrameworkResponseStream {
  private readonly closeListeners = new Set<() => void>();
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private markedActive = false;
  private markedClosed = false;

  readonly readable = new ReadableStream<Uint8Array>({
    cancel: () => {
      this.close();
    },
    start: (controller) => {
      this.controller = controller;
    },
  });

  constructor(private readonly onActivate: () => void) {}

  get closed(): boolean {
    return this.markedClosed;
  }

  close(): void {
    this.activate();

    if (this.markedClosed) {
      return;
    }

    this.markedClosed = true;
    this.controller?.close();
    this.emitClose();
  }

  flush(): void {
    this.activate();
  }

  onClose(listener: () => void): () => void {
    if (this.markedClosed) {
      listener();
      return () => {};
    }

    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  waitForDrain(): Promise<void> {
    this.activate();
    return Promise.resolve();
  }

  write(chunk: string | Uint8Array): boolean {
    this.activate();

    if (this.markedClosed) {
      return false;
    }

    this.controller?.enqueue(typeof chunk === 'string' ? TEXT_ENCODER.encode(chunk) : chunk);
    return true;
  }

  private activate(): void {
    if (this.markedActive) {
      return;
    }

    this.markedActive = true;
    this.onActivate();
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) {
      listener();
    }

    this.closeListeners.clear();
  }
}

class MutableWebFrameworkResponse implements WebFrameworkResponse {
  committed = false;
  headers: Record<string, string | string[]> = {};
  raw?: Response;
  statusCode?: number;
  statusSet?: boolean;

  private finalizedResponse?: Response;
  private readonly responseStream = new WebResponseStream(() => {
    this.streamActive = true;
  });
  private responseBody?: string | Uint8Array;
  private streamActive = false;

  stream: WebFrameworkResponseStream = this.responseStream;

  redirect(status: number, location: string): void {
    this.setStatus(status);
    this.setHeader('Location', location);
    void this.send(undefined);
  }

  async send(body: unknown): Promise<void> {
    if (this.finalizedResponse) {
      this.committed = true;
      return;
    }

    const serialized = serializeWebResponseBody(
      body,
      typeof this.headers['Content-Type'] === 'string'
        ? this.headers['Content-Type']
        : typeof this.headers['content-type'] === 'string'
          ? this.headers['content-type']
          : undefined,
    );

    if (serialized.defaultContentType && !hasHeader(this.headers, 'content-type')) {
      this.setHeader('Content-Type', serialized.defaultContentType);
    }

    this.responseBody = serialized.payload;
    this.committed = true;
  }

  setHeader(name: string, value: string | string[]): void {
    const existingHeaderName = findHeaderName(this.headers, name) ?? name;

    if (name.toLowerCase() === 'set-cookie') {
      this.headers[existingHeaderName] = mergeSetCookieHeader(this.headers[existingHeaderName], value);
      return;
    }

    this.headers[existingHeaderName] = value;
  }

  setStatus(code: number): void {
    this.statusCode = code;
    this.statusSet = true;
  }

  toResponse(): Response {
    if (!this.finalizedResponse) {
      const init: ResponseInit = {
        headers: toResponseHeaders(this.headers),
        status: this.statusCode ?? 200,
      };
      const responseBody = this.responseBody instanceof Uint8Array
        ? this.responseBody.slice().buffer as ArrayBuffer
        : this.responseBody;

      this.finalizedResponse = this.streamActive
        ? new Response(this.responseStream.readable, init)
        : new Response(responseBody ?? '', init);
      this.raw = this.finalizedResponse;
      this.committed = true;
    }

    return this.finalizedResponse;
  }
}

/**
 * Creates the request/response factory used by Web-standard adapters.
 *
 * @param options - Web parsing options for body limits, multipart handling, and raw body retention.
 * @returns A request/response factory for Web requests and responses.
 */
export function createWebRequestResponseFactory(
  options: CreateWebRequestResponseFactoryOptions = {},
): RequestResponseFactory<Request, AbortSignal | undefined, WebFrameworkResponse> {
  return {
    async createRequest(request: Request, signal: AbortSignal) {
      return await createWebFrameworkRequest(
        request,
        signal,
        options.multipart,
        options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
        options.rawBody ?? false,
      );
    },
    createRequestSignal(signal) {
      return signal ?? new AbortController().signal;
    },
    createResponse() {
      return new MutableWebFrameworkResponse();
    },
    resolveRequestId(request) {
      return request.headers.get('x-request-id') ?? request.headers.get('x-correlation-id') ?? undefined;
    },
    async writeErrorResponse(error, response, requestId) {
      const httpError = toHttpException(error);
      response.setStatus(httpError.status);
      await response.send(createErrorResponse(httpError, requestId));
    },
  };
}

/**
 * Dispatches a native Web request through the shared runtime pipeline.
 *
 * @param options - Dispatch configuration including the request and runtime parsing options.
 * @returns The native Web response produced by the dispatcher.
 */
export async function dispatchWebRequest({
  dispatcher,
  dispatcherNotReadyMessage = 'Web adapter received a request before dispatcher binding completed.',
  request,
  ...options
}: DispatchWebRequestOptions): Promise<Response> {
  const frameworkResponse = await dispatchWithRequestResponseFactory({
    dispatcher,
    dispatcherNotReadyMessage,
    factory: createWebRequestResponseFactory(options),
    rawRequest: request,
    rawResponse: request.signal,
  });

  return frameworkResponse.toResponse();
}

/**
 * Creates a framework request from a native Web request.
 *
 * @param request - Native Web request to normalize.
 * @param signal - Abort signal propagated to the framework request.
 * @param multipartOptions - Multipart parser options applied to multipart requests.
 * @param maxBodySize - Maximum allowed non-multipart body size in bytes.
 * @param preserveRawBody - Whether to retain the raw request body bytes.
 * @returns The normalized framework request used by the dispatcher.
 */
export async function createWebFrameworkRequest(
  request: Request,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  preserveRawBody = false,
): Promise<FrameworkRequest> {
  const url = new URL(request.url);
  const headers = cloneWebHeaders(request.headers);
  const contentType = request.headers.get('content-type') ?? undefined;
  const isMultipart = typeof contentType === 'string' && contentType.includes('multipart/form-data');

  let body: unknown;
  let files: UploadedFile[] | undefined;
  let rawBody: Uint8Array | undefined;

  if (isMultipart) {
    const result = await parseMultipart(request.clone(), {
      ...multipartOptions,
      maxTotalSize: multipartOptions?.maxTotalSize ?? maxBodySize,
    });
    body = result.fields;
    files = result.files;
  } else {
    const bodyResult = await readWebRequestBody(request.clone(), contentType, maxBodySize, preserveRawBody);
    body = bodyResult.body;
    rawBody = bodyResult.rawBody;
  }

  const frameworkRequest: WebFrameworkRequest = {
    body,
    cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
    headers,
    method: request.method,
    params: {},
    path: url.pathname,
    query: parseQueryParams(url.searchParams),
    raw: request,
    signal,
    url: url.pathname + url.search,
  };

  if (files) {
    frameworkRequest.files = files;
  }

  if (rawBody) {
    frameworkRequest.rawBody = rawBody;
  }

  return frameworkRequest;
}

function parseQueryParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const current = query[key];

    if (current === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }

    query[key] = [current, value];
  }

  return query;
}

function cloneWebHeaders(headers: Headers): FrameworkRequest['headers'] {
  const clonedHeaders: Record<string, string | string[] | undefined> = {};

  for (const [name, value] of headers.entries()) {
    clonedHeaders[name] = value;
  }

  return clonedHeaders;
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=');

        if (index === -1) {
          return [pair.trim(), ''] as [string, string];
        }

        return [pair.slice(0, index).trim(), decodeCookieValue(pair.slice(index + 1).trim())] as [string, string];
      }),
  );
}

async function readWebRequestBody(
  request: Request,
  contentType: string | undefined,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  preserveRawBody = false,
): Promise<{ body: unknown; rawBody?: Uint8Array }> {
  const contentLength = request.headers.get('content-length');

  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);

    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBodySize) {
      throw new PayloadTooLargeException(REQUEST_BODY_LIMIT_MESSAGE);
    }
  }

  if (!request.body) {
    return { body: undefined };
  }

  const rawBody = await readByteLimitedStream(request.body, maxBodySize);

  if (rawBody.byteLength === 0) {
    return { body: undefined };
  }

  const bodyText = TEXT_DECODER.decode(rawBody);

  if (bodyText.length === 0) {
    return { body: undefined, rawBody: preserveRawBody ? rawBody : undefined };
  }

  if (typeof contentType === 'string' && contentType.includes('application/json')) {
    try {
      return {
        body: JSON.parse(bodyText) as unknown,
        rawBody: preserveRawBody ? rawBody : undefined,
      };
    } catch {
      throw new BadRequestException('Request body contains invalid JSON.');
    }
  }

  return {
    body: bodyText,
    rawBody: preserveRawBody ? rawBody : undefined,
  };
}

async function readByteLimitedStream(
  stream: ReadableStream<Uint8Array>,
  maxBodySize: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalSize += value.byteLength;

      if (totalSize > maxBodySize) {
        await reader.cancel(REQUEST_BODY_LIMIT_MESSAGE);
        throw new PayloadTooLargeException(REQUEST_BODY_LIMIT_MESSAGE);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatUint8Arrays(chunks, totalSize);
}

function concatUint8Arrays(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const rawBody = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return rawBody;
}

function mergeSetCookieHeader(
  current: string | string[] | undefined,
  incoming: string | string[],
): string | string[] {
  const nextValues = Array.isArray(incoming) ? incoming : [incoming];

  if (current === undefined) {
    return nextValues.length === 1 ? nextValues[0] : [...nextValues];
  }

  const currentValues = Array.isArray(current) ? current : [current];
  const merged = [...currentValues, ...nextValues];

  return merged.length === 1 ? merged[0] : merged;
}

function findHeaderName(headers: Record<string, string | string[]>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lowerName);
}

function hasHeader(headers: Record<string, string | string[]>, name: string): boolean {
  return findHeaderName(headers, name) !== undefined;
}

function toResponseHeaders(headers: Record<string, string | string[]>): Headers {
  const responseHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        responseHeaders.append(name, headerValue);
      }
      continue;
    }

    responseHeaders.set(name, value);
  }

  return responseHeaders;
}

function serializeWebResponseBody(
  body: unknown,
  contentType?: string,
): { defaultContentType?: string; payload: string | Uint8Array } {
  if (body === undefined) {
    return { payload: '' };
  }

  if (body instanceof Uint8Array) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: body,
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: new Uint8Array(body),
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

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  return new InternalServerErrorException('Internal server error.', {
    cause: error,
  });
}
