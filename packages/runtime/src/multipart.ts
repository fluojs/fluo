import { BadRequestException, PayloadTooLargeException } from '@fluojs/http';

import { createStreamingMultipart } from './streaming-multipart.js';

/**
 * Represents a single uploaded multipart file buffered in memory.
 */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Uint8Array;
  size: number;
}

/**
 * Configures multipart parsing limits for file size, file count, and total payload size.
 */
export interface MultipartOptions {
  /**
   * Selects buffered or streaming consumption globally, or per request by
   * method and URL. Buffered mode remains the default.
   */
  mode?: MultipartMode | MultipartModeSelector;
  maxFields?: number;
  maxFileSize?: number;
  maxFiles?: number;
  maxHeaders?: number;
  maxHeaderSize?: number;
  maxTotalSize?: number;
}

/** Multipart request-body consumption mode. */
export type MultipartMode = 'buffered' | 'streaming';

/** Metadata available to a per-route multipart mode selector. */
export interface MultipartModeSelectionContext {
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>;
  method: string;
  url: string;
}

/** Selects multipart mode for one request without exposing adapter-native values. */
export type MultipartModeSelector = (request: MultipartModeSelectionContext) => MultipartMode;

/**
 * Contains parsed multipart fields and uploaded files.
 */
export interface MultipartResult {
  fields: Record<string, string | string[]>;
  files: UploadedFile[];
}

/**
 * Describes request-like multipart inputs accepted by the runtime parsers.
 */
export interface MultipartRequestLike {
  body?: AsyncIterable<Uint8Array> | BodyInit | null;
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>;
  method?: string;
  signal?: AbortSignal;
  url?: string;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>;
}

/**
 * Resolves the configured multipart mode for one normalized request.
 *
 * @param options - Multipart application options.
 * @param request - Portable request metadata used by a route selector.
 * @returns Explicit mode selected for this request, defaulting to `buffered`.
 */
export function resolveMultipartMode(
  options: MultipartOptions | undefined,
  request: MultipartModeSelectionContext,
): MultipartMode {
  const selection = options?.mode;
  return typeof selection === 'function' ? selection(request) : selection ?? 'buffered';
}

const DEFAULT_MAX_TOTAL_SIZE = 10 * 1024 * 1024;
const MULTIPART_BODY_LIMIT_MESSAGE = 'Multipart body exceeds the maximum size of';

/**
 * Parses a multipart request into string fields and in-memory uploaded files.
 *
 * @param request - Web `Request` or request-like input carrying a multipart body.
 * @param options - Multipart limits for file size, file count, and total payload size.
 * @returns Parsed string fields plus uploaded files buffered in memory.
 * @throws {PayloadTooLargeException} When the multipart payload, file count, or file size exceeds the configured limits.
 */
export async function parseMultipart(
  request: Request | MultipartRequestLike,
  options: MultipartOptions = {},
): Promise<MultipartResult> {
  const webRequest = toStreamingRequest(request);
  const contentType = webRequest.headers.get('content-type');

  if (!contentType || !webRequest.body) {
    throw new BadRequestException('Multipart request is missing a body or content type.');
  }

  const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;
  const contentLength = Number(webRequest.headers.get('content-length'));

  if (Number.isFinite(contentLength) && contentLength > maxTotalSize) {
    throwMultipartTotalLimit(maxTotalSize);
  }

  const bufferedBody = await readStreamBytes(webRequest.body, maxTotalSize);

  const parserRequest = new Request(webRequest.url, {
    body: bufferedBody,
    headers: new Headers(webRequest.headers),
    method: webRequest.method,
  });
  const multipart = createStreamingMultipart({
    body: parserRequest.body!,
    contentType,
    options: {
      ...options,
      maxTotalSize: bufferedBody.byteLength,
    },
    signal: request.signal,
  });
  const reader = multipart.consume().getReader();
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];

  try {
    for (;;) {
      const result = await reader.read();

      if (result.done) {
        return { fields, files };
      }

      if (result.value.kind === 'field') {
        appendMultipartField(fields, result.value.fieldname, result.value.value);
        continue;
      }

      const buffer = await readStreamBytes(result.value.stream);
      files.push({
        buffer,
        fieldname: result.value.fieldname,
        mimetype: result.value.mimetype,
        originalname: result.value.originalname,
        size: buffer.byteLength,
      });
    }
  } catch (error: unknown) {
    await multipart.cancel(error);
    throw error;
  }
}

function throwMultipartTotalLimit(maxTotalSize: number): never {
  throw new PayloadTooLargeException(
    `${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`,
  );
}

function appendMultipartField(fields: Record<string, string | string[]>, name: string, value: string): void {
  const existing = fields[name];

  if (existing === undefined) {
    fields[name] = value;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }

  fields[name] = [existing, value];
}

function toStreamingRequest(request: Request | MultipartRequestLike): Request {
  if (request instanceof Request) {
    return request;
  }

  const method = request.method ?? 'POST';
  const body = supportsRequestBody(method) ? resolveRequestBody(request) : undefined;
  const init: RequestInit & { duplex?: 'half' } = {
    headers: normalizeRequestHeaders(request.headers),
    method,
  };

  if (body !== undefined) {
    init.body = body as BodyInit;

    if (body instanceof ReadableStream) {
      init.duplex = 'half';
    }
  }

  return new Request(request.url ?? 'http://localhost/', init);
}

function resolveRequestBody(request: MultipartRequestLike): AsyncIterable<Uint8Array> | BodyInit | null | undefined {
  if (request.body !== undefined) {
    return isAsyncIterableBody(request.body) ? createReadableStreamFromAsyncIterable(request.body) : request.body;
  }

  if (typeof request[Symbol.asyncIterator] === 'function') {
    return createReadableStreamFromAsyncIterable(request as AsyncIterable<Uint8Array>);
  }

  return undefined;
}

function supportsRequestBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function isAsyncIterableBody(body: AsyncIterable<Uint8Array> | BodyInit | null): body is AsyncIterable<Uint8Array> {
  return body !== null && typeof body === 'object' && Symbol.asyncIterator in body;
}

function createReadableStreamFromAsyncIterable(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return?.();
    },
    async pull(controller) {
      const { done, value } = await iterator.next();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
  });
}

async function readStreamBytes(
  stream: ReadableStream<Uint8Array>,
  maxSize?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
    size += result.value.byteLength;

    if (maxSize !== undefined && size > maxSize) {
      await drainStreamReader(reader);
      throwMultipartTotalLimit(maxSize);
    }
  }

  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

async function drainStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  for (;;) {
    const result = await reader.read();

    if (result.done) {
      return;
    }
  }
}

function normalizeRequestHeaders(
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
): Headers {
  if (headers instanceof Headers) {
    return new Headers(headers);
  }

  const normalized = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        normalized.append(name, headerValue);
      }
      continue;
    }

    if (value !== undefined) {
      normalized.set(name, value);
    }
  }

  return normalized;
}
