import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { URL } from 'node:url';

import {
  BadRequestException,
  PayloadTooLargeException,
  type FrameworkRequest,
} from '@fluojs/http';

import {
  parseMultipart,
  type MultipartOptions,
  type UploadedFile,
} from '../multipart.js';

type NodeFrameworkRequest = FrameworkRequest & {
  files?: UploadedFile[];
  materializeBody?: () => Promise<void>;
  rawBody?: Uint8Array;
};

type MemoizedValue<T> = () => T;

/**
 * HTTP payload-size error that closes the underlying Node request stream after the response commits.
 */
export class NodeRequestPayloadTooLargeException extends PayloadTooLargeException {
  constructor(private readonly request: IncomingMessage) {
    super('Request body exceeds the size limit.');
  }

  prepareResponse(response: ServerResponse): void {
    response.setHeader('Connection', 'close');

    const destroyRequest = () => {
      if (!this.request.destroyed) {
        this.request.destroy();
      }
    };

    response.once('finish', destroyRequest);
    response.once('close', destroyRequest);
    this.request.pause();
  }
}

/**
 * Creates a framework request from a raw Node incoming message.
 *
 * @param request - Raw Node request carrying headers, URL, and body stream.
 * @param signal - Abort signal tied to the response lifecycle.
 * @param multipartOptions - Multipart parser options applied to multipart requests.
 * @param maxBodySize - Maximum allowed non-multipart body size in bytes.
 * @param preserveRawBody - Whether to retain the raw request body bytes.
 * @returns The normalized framework request used by the dispatcher.
 */
export async function createFrameworkRequest(
  request: IncomingMessage,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = 1 * 1024 * 1024,
  preserveRawBody = false,
): Promise<FrameworkRequest> {
  const frameworkRequest = createDeferredFrameworkRequest(
    request,
    signal,
    multipartOptions,
    maxBodySize,
    preserveRawBody,
  );
  await materializeFrameworkRequestBody(frameworkRequest);

  return frameworkRequest;
}

/**
 * Creates the cheap Node framework request shell before consuming the body stream.
 *
 * @param request - Raw Node request carrying headers, URL, and body stream.
 * @param signal - Abort signal tied to the response lifecycle.
 * @param multipartOptions - Multipart parser options applied when materializing multipart requests.
 * @param maxBodySize - Maximum allowed non-multipart body size in bytes.
 * @param preserveRawBody - Whether materialization should retain raw request body bytes.
 * @returns The framework request shell with metadata snapshotted and body materialization deferred.
 */
export function createDeferredFrameworkRequest(
  request: IncomingMessage,
  signal: AbortSignal,
  multipartOptions?: MultipartOptions,
  maxBodySize = 1 * 1024 * 1024,
  preserveRawBody = false,
): FrameworkRequest {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = cloneRequestHeaders(request.headers);
  const cookieHeader = cloneHeaderValue(headers.cookie);
  const searchParams = new URLSearchParams(url.searchParams);
  const cookies = createMemoizedValue(() => parseCookieHeader(cookieHeader));
  const query = createMemoizedValue(() => parseQueryParams(searchParams));
  const contentType = normalizePrimaryContentType(headers['content-type']);
  const isMultipart = contentType === 'multipart/form-data';
  const materializeBody = createMemoizedAsyncValue(async () => {
    if (isMultipart) {
      const result = await parseMultipart(
        {
          body: Readable.toWeb(request),
          headers,
          method: request.method,
          url: url.toString(),
        },
        {
          ...multipartOptions,
          maxTotalSize: multipartOptions?.maxTotalSize ?? maxBodySize,
        },
      );
      frameworkRequest.body = result.fields;
      frameworkRequest.files = result.files;
      return;
    }

    if (!hasNodeRequestBody(request)) {
      frameworkRequest.body = undefined;
      return;
    }

    const bodyResult = await readRequestBody(request, headers['content-type'], maxBodySize, preserveRawBody);
    frameworkRequest.body = bodyResult.body;

    if (bodyResult.rawBody) {
      frameworkRequest.rawBody = bodyResult.rawBody;
    }
  });

  const frameworkRequest: NodeFrameworkRequest = {
    get cookies() {
      return cookies();
    },
    headers,
    method: request.method ?? 'GET',
    params: {},
    path: url.pathname,
    get query() {
      return query();
    },
    raw: request,
    signal,
    url: url.pathname + url.search,
    materializeBody,
  };

  return frameworkRequest;
}

function hasNodeRequestBody(request: IncomingMessage): boolean {
  const contentLength = request.headers['content-length'];
  const transferEncoding = request.headers['transfer-encoding'];
  const primaryContentLength = Array.isArray(contentLength) ? contentLength[0] : contentLength;

  if (transferEncoding !== undefined) {
    return true;
  }

  if (primaryContentLength === undefined) {
    return true;
  }

  const parsedContentLength = Number(primaryContentLength);

  return !Number.isFinite(parsedContentLength) || parsedContentLength !== 0;
}

/**
 * Materializes a deferred Node framework request body exactly once.
 *
 * @param request - Framework request returned by {@link createDeferredFrameworkRequest}.
 * @returns A promise that settles after body, rawBody, and files fields are populated when applicable.
 */
export async function materializeFrameworkRequestBody(request: FrameworkRequest): Promise<void> {
  await (request as NodeFrameworkRequest).materializeBody?.();
  delete (request as NodeFrameworkRequest).materializeBody;
}

function createMemoizedValue<T>(factory: () => T): MemoizedValue<T> {
  let initialized = false;
  let value: T;

  return () => {
    if (!initialized) {
      value = factory();
      initialized = true;
    }

    return value;
  };
}

function createMemoizedAsyncValue(factory: () => Promise<void>): () => Promise<void> {
  let promise: Promise<void> | undefined;

  return () => {
    promise ??= factory();
    return promise;
  };
}

/**
 * Creates an abort signal that fires when the Node response closes unexpectedly.
 *
 * @param response - Raw Node server response associated with the request.
 * @returns An abort signal for downstream request cancellation handling.
 */
export function createRequestSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  const abort = (reason: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(reason));
    }
  };

  response.once('close', () => {
    if (!response.writableEnded) {
      abort('Response closed before response commit.');
    }
  });

  return controller.signal;
}

/**
 * Resolves the request identifier from the preferred inbound headers.
 *
 * @param headers - Raw Node request headers.
 * @returns The request identifier when present.
 */
export function resolveRequestIdFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  const requestId = headers['x-request-id'] ?? headers['x-correlation-id'];
  return Array.isArray(requestId) ? requestId[0] : requestId;
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

function cloneRequestHeaders(headers: IncomingHttpHeaders): FrameworkRequest['headers'] {
  const clonedEntries = Object.entries(headers).map(([name, value]) => [name, cloneHeaderValue(value)]);

  return Object.fromEntries(clonedEntries);
}

function cloneHeaderValue<T extends string | string[] | undefined>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function readPrimaryHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

function normalizePrimaryContentType(headerValue: string | string[] | undefined): string | undefined {
  const primaryHeaderValue = readPrimaryHeaderValue(headerValue);

  if (typeof primaryHeaderValue !== 'string') {
    return undefined;
  }

  const [mediaType] = primaryHeaderValue.split(';', 1);
  const normalizedMediaType = mediaType?.trim().toLowerCase();

  return normalizedMediaType && normalizedMediaType.length > 0 ? normalizedMediaType : undefined;
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseCookieHeader(cookieHeader: string | string[] | undefined): Record<string, string> {
  const normalizedCookieHeader = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;

  if (!normalizedCookieHeader) {
    return {};
  }

  return Object.fromEntries(
    normalizedCookieHeader
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

async function readRequestBody(
  request: IncomingMessage,
  contentType: string | string[] | undefined,
  maxBodySize = 1 * 1024 * 1024,
  preserveRawBody = false,
): Promise<{ body: unknown; rawBody?: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  for await (const chunk of request) {
    const buf: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalSize += buf.byteLength;

    if (totalSize > maxBodySize) {
      throw new NodeRequestPayloadTooLargeException(request);
    }

    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return { body: undefined };
  }

  const rawBody = Buffer.concat(chunks);
  const bodyText = rawBody.toString('utf8');

  if (bodyText.length === 0) {
    return { body: undefined, rawBody: preserveRawBody ? rawBody : undefined };
  }

  const primaryContentType = normalizePrimaryContentType(contentType);

  if (primaryContentType === 'application/json') {
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
