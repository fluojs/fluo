import { PayloadTooLargeException } from '@konekti/http';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface MultipartOptions {
  maxFileSize?: number;
  maxFiles?: number;
}

export interface MultipartResult {
  fields: Record<string, string | string[]>;
  files: UploadedFile[];
}

export interface MultipartRequestLike {
  body?: AsyncIterable<Uint8Array> | BodyInit | null;
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>;
  method?: string;
  url?: string;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;

export async function parseMultipart(
  request: Request | MultipartRequestLike,
  options: MultipartOptions = {},
): Promise<MultipartResult> {
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const formData = await toWebRequest(request).formData();
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];

  for (const [fieldname, value] of formData.entries()) {
    if (typeof value === 'string') {
      appendMultipartField(fields, fieldname, value);
      continue;
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

function toWebRequest(request: Request | MultipartRequestLike): Request {
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
    if (isStreamingBody(body)) {
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

function isStreamingBody(body: AsyncIterable<Uint8Array> | BodyInit | null): boolean {
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
