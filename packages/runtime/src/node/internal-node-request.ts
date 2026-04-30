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

type QueryRecord = Record<string, string | string[] | undefined>;

/**
 * Options for creating a deferred framework request shell from a Node-backed adapter.
 */
export interface DeferredFrameworkRequestShellOptions<RawRequest> {
  cookieHeader?: string | string[] | undefined;
  headers?: FrameworkRequest['headers'];
  headersFactory?: () => FrameworkRequest['headers'];
  materializeBody?: () => Promise<void>;
  method?: string;
  path: string;
  query?: QueryRecord;
  queryFactory?: () => QueryRecord;
  raw: RawRequest;
  signal: AbortSignal;
  url: string;
}

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
  const rawUrl = request.url ?? '/';
  const urlParts = splitRawRequestUrl(rawUrl);
  const headers = cloneRequestHeaders(request.headers);
  const contentType = normalizePrimaryContentType(headers['content-type']);
  const isMultipart = contentType === 'multipart/form-data';
  let frameworkRequest!: NodeFrameworkRequest;
  const materializeBody = createMemoizedAsyncValue(async () => {
    if (isMultipart) {
      const result = await parseMultipart(
        {
          body: Readable.toWeb(request),
          headers,
          method: request.method,
          url: resolveAbsoluteRequestUrl(rawUrl),
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

  frameworkRequest = createDeferredFrameworkRequestShell({
    cookieHeader: cloneHeaderValue(headers.cookie),
    headers,
    materializeBody,
    method: request.method,
    path: urlParts.path,
    queryFactory: () => parseQueryParamsFromSearch(urlParts.search),
    raw: request,
    signal,
    url: urlParts.path + urlParts.search,
  }) as NodeFrameworkRequest;

  return frameworkRequest;
}

/**
 * Creates a framework request shell from already-snapshotted Node adapter metadata.
 *
 * @param options - Raw request, metadata factories, and deferred body materialization hooks.
 * @returns A framework request with lazy headers, cookies, query values, and optional body materialization.
 */
export function createDeferredFrameworkRequestShell<RawRequest>({
  cookieHeader,
  headers,
  headersFactory,
  materializeBody,
  method,
  path,
  query,
  queryFactory,
  raw,
  signal,
  url,
}: DeferredFrameworkRequestShellOptions<RawRequest>): FrameworkRequest {
  const resolveHeaders = headersFactory ? createMemoizedValue(headersFactory) : () => headers ?? {};
  const resolveCookies = createMemoizedValue(() => parseCookieHeader(cookieHeader ?? resolveHeaders().cookie));
  const resolveQuery = createMemoizedValue(() => query ?? queryFactory?.() ?? {});

  const frameworkRequest: NodeFrameworkRequest = {
    get cookies() {
      return resolveCookies();
    },
    get headers() {
      return resolveHeaders();
    },
    method: method ?? 'GET',
    params: {},
    path,
    get query() {
      return resolveQuery();
    },
    raw,
    signal,
    url,
  };

  if (materializeBody) {
    frameworkRequest.materializeBody = materializeBody;
  }

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

/**
 * Creates a synchronous memoized value resolver.
 *
 * @param factory - Function that computes the value on first access.
 * @returns A stable resolver that returns the cached value after the first call.
 */
export function createMemoizedValue<T>(factory: () => T): MemoizedValue<T> {
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

/**
 * Creates an async memoized side-effect resolver.
 *
 * @param factory - Async function to run at most once.
 * @returns A resolver that returns the same in-flight or completed promise for every call.
 */
export function createMemoizedAsyncValue(factory: () => Promise<void>): () => Promise<void> {
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

/**
 * Parses a raw URL search string into the framework query shape.
 *
 * @param search - Raw search string, with or without a leading question mark.
 * @returns Query values where repeated keys become string arrays.
 */
export function parseQueryParamsFromSearch(search: string): Record<string, string | string[]> {
  return parseQueryParams(new URLSearchParams(search));
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

/**
 * Snapshots host-parsed query values when they already match framework semantics.
 *
 * @param query - Host query object exposed by a Node-backed adapter.
 * @returns A cloned query record when all values are strings or string arrays; otherwise `undefined` for raw URL fallback.
 */
export function snapshotSimpleQueryRecord(query: unknown): QueryRecord | undefined {
  if (typeof query !== 'object' || query === null) {
    return undefined;
  }

  const snapshot: QueryRecord = {};

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      snapshot[key] = value;
      continue;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      snapshot[key] = [...value];
      continue;
    }

    return undefined;
  }

  return snapshot;
}

/**
 * Clones Node request headers into the framework header record shape.
 *
 * @param headers - Raw Node incoming headers.
 * @returns A shallow header snapshot with array values cloned.
 */
export function cloneRequestHeaders(headers: IncomingHttpHeaders): FrameworkRequest['headers'] {
  const clonedEntries = Object.entries(headers).map(([name, value]) => [name, cloneHeaderValue(value)]);

  return Object.fromEntries(clonedEntries);
}

/**
 * Clones a single Node header value when it is array-backed.
 *
 * @param value - Header value to snapshot.
 * @returns The original scalar value or a cloned array value.
 */
export function cloneHeaderValue<T extends string | string[] | undefined>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

/**
 * Reads the primary value from a Node header value.
 *
 * @param headerValue - Header value that may contain multiple entries.
 * @returns The first header value when present.
 */
export function readPrimaryHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

/**
 * Normalizes a Node content-type header to its primary media type.
 *
 * @param headerValue - Raw content-type header value.
 * @returns Lowercase primary media type without parameters, or `undefined` when absent.
 */
export function normalizePrimaryContentType(headerValue: string | string[] | undefined): string | undefined {
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

/**
 * Parses a Node cookie header into framework cookie values.
 *
 * @param cookieHeader - Raw cookie header value or values.
 * @returns Cookie name/value pairs with percent-decoded values when possible.
 */
export function parseCookieHeader(cookieHeader: string | string[] | undefined): Record<string, string> {
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

/**
 * Splits a raw Node request URL into path and search components.
 *
 * @param rawUrl - Raw request URL, absolute URL, or undefined value from Node.
 * @returns The pathname and search string used by framework request matching and query parsing.
 */
export function splitRawRequestUrl(rawUrl: string | undefined): { path: string; search: string } {
  const resolvedRawUrl = rawUrl ?? '/';

  if (resolvedRawUrl.startsWith('http://') || resolvedRawUrl.startsWith('https://')) {
    const url = new URL(resolvedRawUrl);
    return { path: url.pathname, search: url.search };
  }

  const queryStart = resolvedRawUrl.indexOf('?');
  const hashStart = resolvedRawUrl.indexOf('#');
  const pathEndCandidates = [queryStart, hashStart].filter((index) => index >= 0);
  const pathEnd = pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : resolvedRawUrl.length;
  const path = resolvedRawUrl.slice(0, pathEnd) || '/';

  if (queryStart === -1) {
    return { path, search: '' };
  }

  const searchEnd = hashStart >= 0 && hashStart > queryStart ? hashStart : resolvedRawUrl.length;
  return {
    path,
    search: resolvedRawUrl.slice(queryStart, searchEnd),
  };
}

/**
 * Resolves a raw Node request URL into an absolute URL string.
 *
 * @param rawUrl - Raw request URL, absolute URL, or undefined value from Node.
 * @returns An absolute URL suitable for Web-standard parsers.
 */
export function resolveAbsoluteRequestUrl(rawUrl: string | undefined): string {
  const resolvedRawUrl = rawUrl ?? '/';

  if (resolvedRawUrl.startsWith('http://') || resolvedRawUrl.startsWith('https://')) {
    return resolvedRawUrl;
  }

  return new URL(resolvedRawUrl, 'http://localhost').toString();
}
