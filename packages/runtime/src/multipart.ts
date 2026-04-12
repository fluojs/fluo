import { PayloadTooLargeException } from '@fluojs/http';

/**
 * Represents a single uploaded multipart file buffered in memory.
 */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Configures multipart parsing limits for file size, file count, and total payload size.
 */
export interface MultipartOptions {
  maxFileSize?: number;
  maxFiles?: number;
  maxTotalSize?: number;
}

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
  url?: string;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
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
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;

  const formData = await toWebRequest(request, maxTotalSize).formData();
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];
  let totalSize = 0;

  for (const [fieldname, value] of formData.entries()) {
    if (typeof value === 'string') {
      totalSize += Buffer.byteLength(value, 'utf8');

      if (totalSize > maxTotalSize) {
        throw new PayloadTooLargeException(`${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`);
      }

      appendMultipartField(fields, fieldname, value);
      continue;
    }

    totalSize += value.size;

    if (totalSize > maxTotalSize) {
      throw new PayloadTooLargeException(`${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`);
    }

    if (files.length >= maxFiles) {
      throw new PayloadTooLargeException(`Exceeded maximum file count of ${String(maxFiles)}.`);
    }

    if (value.size > maxFileSize) {
      throw new PayloadTooLargeException(`File "${fieldname}" exceeds the maximum size of ${String(maxFileSize)} bytes.`);
    }

    files.push({
      buffer: Buffer.from(await value.arrayBuffer()),
      fieldname,
      mimetype: value.type,
      originalname: value.name,
      size: value.size,
    });
  }

  return { fields, files };
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

function toWebRequest(request: Request | MultipartRequestLike, maxTotalSize: number): Request {
  if (request instanceof Request) {
    return createMultipartRequest(
      request.url,
      request.method,
      new Headers(request.headers),
      request.body,
      maxTotalSize,
    );
  }

  const method = request.method ?? 'POST';
  const body = supportsRequestBody(method) ? resolveRequestBody(request) : undefined;
  return createMultipartRequest(
    request.url ?? 'http://localhost/',
    method,
    normalizeRequestHeaders(request.headers),
    body,
    maxTotalSize,
  );
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

function isStreamingBody(
  body: AsyncIterable<Uint8Array> | BodyInit | null,
): body is AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> {
  return body instanceof ReadableStream || isAsyncIterableBody(body);
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

function createMultipartRequest(
  url: string,
  method: string,
  headers: Headers,
  body: AsyncIterable<Uint8Array> | BodyInit | null | undefined,
  maxTotalSize: number,
): Request {
  const contentLength = headers.get('content-length');

  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);

    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxTotalSize) {
      throw new PayloadTooLargeException(`${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`);
    }
  }

  const init: RequestInit & { duplex?: 'half' } = {
    headers,
    method,
  };

  if (body !== undefined) {
    const limitedBody = body !== null && isStreamingBody(body)
      ? createByteLimitedReadableStream(body, maxTotalSize)
      : body as BodyInit;

    init.body = limitedBody;

    if (limitedBody instanceof ReadableStream) {
      init.duplex = 'half';
    }
  }

  return new Request(url, init);
}

function createByteLimitedReadableStream(
  stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  maxTotalSize: number,
): ReadableStream<Uint8Array> {
  const source = stream instanceof ReadableStream ? stream : createReadableStreamFromAsyncIterable(stream);
  const reader = source.getReader();
  let totalSize = 0;

  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        controller.close();
        return;
      }

      totalSize += value.byteLength;

      if (totalSize > maxTotalSize) {
        const error = new PayloadTooLargeException(`${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`);
        await reader.cancel(error.message);
        controller.error(error);
        return;
      }

      controller.enqueue(value);
    },
  });
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
