import { PayloadTooLargeException } from '@fluojs/http/portable';

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
 * Configures multipart parsing limits for fields, files, headers, and total payload size.
 */
export interface MultipartOptions {
  /**
   * Selects bounded streaming defaults when an application adapter exposes multipart parts through `request.body`.
   *
   * `parseMultipart(...)` remains buffered regardless of this option so its established acceptance defaults stay intact.
   */
  strategy?: 'buffered' | 'stream';
  /** Maximum size in bytes for one non-file field. */
  maxFieldSize?: number;
  /** Maximum number of non-file fields. */
  maxFields?: number;
  maxFileSize?: number;
  maxFiles?: number;
  /** Maximum size in bytes for one part header block. */
  maxHeaderSize?: number;
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
  signal?: AbortSignal;
  url?: string;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>;
}

/**
 * A decoded non-file multipart field.
 */
export interface MultipartFieldPart {
  readonly headers: Readonly<Record<string, string>>;
  readonly kind: 'field';
  readonly name: string;
  readonly value: string;
}

/**
 * A multipart file whose bytes are read exactly once from a portable Web stream.
 */
export interface MultipartFilePart {
  readonly contentType: string;
  readonly filename: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly kind: 'file';
  readonly name: string;
  readonly stream: ReadableStream<Uint8Array>;
}

/**
 * A typed item yielded by {@link parseMultipartStream}.
 */
export type MultipartPart = MultipartFieldPart | MultipartFilePart;

/**
 * Signals that a multipart body has already been selected for buffered or streaming consumption.
 */
export class MultipartBodyConsumedError extends Error {
  constructor() {
    super('Multipart request body has already been consumed.');
    this.name = 'MultipartBodyConsumedError';
  }
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FIELD_SIZE = 1 * 1024 * 1024;
const DEFAULT_MAX_FIELDS = 100;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_HEADER_SIZE = 8 * 1024;
const DEFAULT_MAX_TOTAL_SIZE = 10 * 1024 * 1024;
const MULTIPART_BODY_LIMIT_MESSAGE = 'Multipart body exceeds the maximum size of';
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const CONSUMED_MULTIPART_INPUTS = new WeakSet<object>();

/**
 * Parses a multipart request into string fields and in-memory uploaded files.
 *
 * @param request - Web `Request` or request-like input carrying a multipart body.
 * @param options - Multipart limits for file size, file count, and total payload size.
 * @returns Parsed string fields plus uploaded files buffered in memory.
 * @throws {PayloadTooLargeException} When any configured field, file, header, or total-size limit is exceeded.
 */
export async function parseMultipart(
  request: Request | MultipartRequestLike,
  options: MultipartOptions = {},
): Promise<MultipartResult> {
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];

  for await (const part of createMultipartParts(request, options, false)) {
    if (part.kind === 'field') {
      appendMultipartField(fields, part.name, part.value);
      continue;
    }

    const buffer = new Uint8Array(await new Response(part.stream).arrayBuffer());

    files.push({
      buffer,
      fieldname: part.name,
      mimetype: part.contentType,
      originalname: part.filename,
      size: buffer.byteLength,
    });
  }

  return { fields, files };
}

/**
 * Streams multipart fields and file parts from a request body.
 *
 * A yielded file stream must finish or be cancelled before requesting the next part. Calling
 * this function selects the request body for streaming consumption; callers cannot also use
 * {@link parseMultipart} for the same request body.
 *
 * @param request - Web `Request` or request-like input carrying a multipart body.
 * @param options - Limits enforced while parsing headers, fields, files, and total input bytes.
 * @returns An async iterator of typed field and file parts.
 * @throws {MultipartBodyConsumedError} When buffered or streaming parsing already selected the body.
 */
export function parseMultipartStream(
  request: Request | MultipartRequestLike,
  options: MultipartOptions = {},
): AsyncIterableIterator<MultipartPart> {
  return createMultipartParts(request, options, true);
}

function createMultipartParts(
  request: Request | MultipartRequestLike,
  options: MultipartOptions,
  useStreamingDefaults: boolean,
): AsyncIterableIterator<MultipartPart> {
  markMultipartBodyConsumed(request);
  return new MultipartPartIterator(new MultipartStreamParser(request, options, useStreamingDefaults));
}

/**
 * Marks an input as selected for buffered or streaming multipart consumption.
 *
 * @param request - Request input whose body cannot be selected again.
 * @internal
 */
export function markMultipartBodyConsumed(request: Request | MultipartRequestLike): void {
  const body = request instanceof Request ? request.body : request.body;
  const inputs: object[] = [request];

  if (body !== null && typeof body === 'object') {
    inputs.push(body);
  }

  if (
    (request instanceof Request && request.bodyUsed)
    || inputs.some((input) => CONSUMED_MULTIPART_INPUTS.has(input))
  ) {
    throw new MultipartBodyConsumedError();
  }

  for (const input of inputs) {
    CONSUMED_MULTIPART_INPUTS.add(input);
  }
}

class MultipartPartIterator implements AsyncIterableIterator<MultipartPart> {
  private closed = false;

  constructor(private readonly parser: MultipartStreamParser) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<MultipartPart> {
    return this;
  }

  async next(): Promise<IteratorResult<MultipartPart>> {
    if (this.closed) {
      return { done: true, value: undefined };
    }

    const part = await this.parser.nextPart();

    if (part === undefined) {
      this.closed = true;
      return { done: true, value: undefined };
    }

    return { done: false, value: part };
  }

  async return(): Promise<IteratorResult<MultipartPart>> {
    this.closed = true;
    this.parser.closeIfIncomplete();
    return { done: true, value: undefined };
  }
}

class MultipartStreamParser {
  private activeFile = false;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private cancellationStarted = false;
  private done = false;
  private failure?: Error;
  private fileController?: ReadableStreamDefaultController<Uint8Array>;
  private readonly fileDelimiter: Uint8Array;
  private readonly initialDelimiter: Uint8Array;
  private initialized = false;
  private readonly maxFieldSize: number;
  private readonly maxFields: number;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private readonly maxHeaderSize: number;
  private readonly maxTotalSize: number;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readerReadPending = false;
  private released = false;
  private readonly signal?: AbortSignal;
  private terminalDrained = false;
  private totalSize = 0;
  private fieldCount = 0;
  private fileCount = 0;
  private partEnded = false;

  constructor(
    request: Request | MultipartRequestLike,
    options: MultipartOptions,
    useStreamingDefaults: boolean,
  ) {
    const headers = normalizeRequestHeaders(request.headers);
    const boundary = extractMultipartBoundary(headers.get('content-type'));

    this.initialDelimiter = TEXT_ENCODER.encode(`--${boundary}`);
    this.fileDelimiter = TEXT_ENCODER.encode(`\r\n--${boundary}`);
    this.maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;
    this.maxFieldSize = options.maxFieldSize
      ?? (useStreamingDefaults ? DEFAULT_MAX_FIELD_SIZE : this.maxTotalSize);
    this.maxFields = options.maxFields
      ?? (useStreamingDefaults ? DEFAULT_MAX_FIELDS : Number.MAX_SAFE_INTEGER);
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxHeaderSize = options.maxHeaderSize
      ?? (useStreamingDefaults ? DEFAULT_MAX_HEADER_SIZE : this.maxTotalSize);
    this.signal = request instanceof Request ? request.signal : request.signal;
    this.reader = resolveMultipartStreamBody(request).getReader();
    this.signal?.addEventListener('abort', this.handleAbort, { once: true });

    if (this.signal?.aborted) {
      this.handleAbort();
    }

    const contentLengthError = getContentLengthError(headers, this.maxTotalSize);

    if (contentLengthError) {
      this.fail(contentLengthError);
    } else if (this.signal?.aborted) {
      this.fail(toAbortError(this.signal.reason));
    }
  }

  async nextPart(): Promise<MultipartPart | undefined> {
    this.throwIfFailed();

    if (this.activeFile) {
      throw new Error('Consume or cancel the active multipart file stream before reading the next part.');
    }

    if (!this.initialized) {
      await this.consumeInitialDelimiter();
      this.initialized = true;
    }

    if (this.done) {
      await this.drainAfterClosingBoundary();
      this.release();
      return undefined;
    }

    const headers = await this.readHeaders();
    let disposition: { filename?: string; name: string };

    try {
      disposition = parseContentDisposition(headers['content-disposition']);
    } catch (error: unknown) {
      this.fail(error);
      throw error;
    }

    if (disposition.filename === undefined) {
      this.fieldCount += 1;

      if (this.fieldCount > this.maxFields) {
        this.fail(new PayloadTooLargeException(`Exceeded maximum field count of ${String(this.maxFields)}.`));
        this.throwIfFailed();
      }

      const value = await this.readFieldValue();
      return {
        headers,
        kind: 'field',
        name: disposition.name,
        value,
      };
    }

    this.fileCount += 1;

    if (this.fileCount > this.maxFiles) {
      this.fail(new PayloadTooLargeException(`Exceeded maximum file count of ${String(this.maxFiles)}.`));
      this.throwIfFailed();
    }

    this.activeFile = true;
    return {
      contentType: headers['content-type'] ?? 'application/octet-stream',
      filename: disposition.filename,
      headers,
      kind: 'file',
      name: disposition.name,
      stream: this.createFileStream(disposition.name),
    };
  }

  closeIfIncomplete(): void {
    if (!this.failure && (this.activeFile || !this.terminalDrained)) {
      this.fail(new Error('Multipart parser has been cancelled.'));
    }
  }

  private readonly handleAbort = (): void => {
    this.fail(toAbortError(this.signal?.reason));
  };

  private createFileStream(name: string): ReadableStream<Uint8Array> {
    let size = 0;

    return new ReadableStream<Uint8Array>({
      cancel: async (reason) => {
        this.fail(reason);
      },
      pull: async (controller) => {
        this.fileController = controller;

        try {
          const chunk = await this.readPartChunk();

          if (chunk === undefined) {
            this.activeFile = false;
            this.fileController = undefined;
            controller.close();
            return;
          }

          size += chunk.byteLength;

          if (size > this.maxFileSize) {
            const error = new PayloadTooLargeException(
              `File "${name}" exceeds the maximum size of ${String(this.maxFileSize)} bytes.`,
            );
            this.fail(error);
            throw error;
          }

          controller.enqueue(chunk);
        } catch (error: unknown) {
          const parserError = toError(error);
          this.activeFile = false;
          this.fileController = undefined;
          controller.error(parserError);
          throw parserError;
        }
      },
    }, { highWaterMark: 0 });
  }

  private async consumeInitialDelimiter(): Promise<void> {
    await this.ensure(this.initialDelimiter.byteLength + 2);

    if (!matchesAt(this.buffer, this.initialDelimiter, 0)) {
      this.fail(new Error('Multipart body does not start with its declared boundary.'));
      this.throwIfFailed();
    }

    this.consume(this.initialDelimiter.byteLength);
    const ending = this.consume(2);

    if (equalsBytes(ending, TEXT_ENCODER.encode('--'))) {
      this.done = true;
      return;
    }

    if (!equalsBytes(ending, TEXT_ENCODER.encode('\r\n'))) {
      this.fail(new Error('Multipart boundary is malformed.'));
      this.throwIfFailed();
    }
  }

  private async readHeaders(): Promise<Readonly<Record<string, string>>> {
    const headerBytes = await this.readUntil(TEXT_ENCODER.encode('\r\n\r\n'), this.maxHeaderSize, (
      `Multipart part headers exceed the maximum size of ${String(this.maxHeaderSize)} bytes.`
    ));
    const headers: Record<string, string> = {};

    for (const line of TEXT_DECODER.decode(headerBytes).split('\r\n')) {
      const separator = line.indexOf(':');

      if (separator <= 0) {
        this.fail(new Error('Multipart part contains a malformed header.'));
        this.throwIfFailed();
      }

      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();

      if (headers[name] !== undefined) {
        this.fail(new Error(`Multipart part contains a repeated "${name}" header.`));
        this.throwIfFailed();
      }

      headers[name] = value;
    }

    return Object.freeze(headers);
  }

  private async readFieldValue(): Promise<string> {
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const chunk = await this.readPartChunk();

      if (chunk === undefined) {
        break;
      }

      size += chunk.byteLength;

      if (size > this.maxFieldSize) {
        this.fail(new PayloadTooLargeException(
          `Field exceeds the maximum size of ${String(this.maxFieldSize)} bytes.`,
        ));
        this.throwIfFailed();
      }

      chunks.push(chunk);
    }

    return TEXT_DECODER.decode(concatBytes(chunks, size));
  }

  private async readPartChunk(): Promise<Uint8Array | undefined> {
    if (this.partEnded) {
      this.partEnded = false;
      if (this.done) {
        await this.drainAfterClosingBoundary();
      }
      return undefined;
    }

    while (true) {
      this.throwIfFailed();
      const delimiterIndex = indexOfBytes(this.buffer, this.fileDelimiter);

      if (delimiterIndex !== -1) {
        const suffixOffset = delimiterIndex + this.fileDelimiter.byteLength;
        const suffixLength = 2;

        if (this.buffer.byteLength < suffixOffset + suffixLength) {
          if (delimiterIndex > 0) {
            return this.consume(delimiterIndex);
          }

          await this.readMore();
          continue;
        }

        const ending = this.buffer.slice(suffixOffset, suffixOffset + suffixLength);

        if (equalsBytes(ending, TEXT_ENCODER.encode('--'))) {
          const chunk = this.consume(delimiterIndex);
          this.consume(this.fileDelimiter.byteLength + suffixLength);
          this.done = true;
          this.partEnded = chunk.byteLength > 0;

          if (chunk.byteLength === 0) {
            await this.drainAfterClosingBoundary();
            return undefined;
          }

          return chunk;
        } else if (equalsBytes(ending, TEXT_ENCODER.encode('\r\n'))) {
          const chunk = this.consume(delimiterIndex);
          this.consume(this.fileDelimiter.byteLength + suffixLength);
          this.partEnded = chunk.byteLength > 0;
          return chunk.byteLength === 0 ? undefined : chunk;
        }

        return this.consume(suffixOffset);
      }

      const retainedBytes = this.fileDelimiter.byteLength - 1;

      if (this.buffer.byteLength > retainedBytes) {
        return this.consume(this.buffer.byteLength - retainedBytes);
      }

      await this.readMore();
    }
  }

  private async readUntil(delimiter: Uint8Array, limit: number, message: string): Promise<Uint8Array> {
    while (true) {
      this.throwIfFailed();
      const delimiterIndex = indexOfBytes(this.buffer, delimiter);

      if (delimiterIndex !== -1) {
        const value = this.consume(delimiterIndex);
        this.consume(delimiter.byteLength);

        if (value.byteLength > limit) {
          this.fail(new PayloadTooLargeException(message));
          this.throwIfFailed();
        }

        return value;
      }

      const confirmedSize = this.buffer.byteLength - trailingDelimiterPrefixLength(this.buffer, delimiter);

      if (confirmedSize > limit) {
        this.fail(new PayloadTooLargeException(message));
        this.throwIfFailed();
      }

      await this.readMore();
    }
  }

  private async ensure(size: number): Promise<void> {
    while (this.buffer.byteLength < size) {
      await this.readMore();
    }
  }

  private async readMore(allowEof = false): Promise<boolean> {
    this.throwIfFailed();
    this.readerReadPending = true;
    let result: ReadableStreamReadResult<Uint8Array>;

    try {
      result = await this.reader.read();
    } catch (error: unknown) {
      this.fail(error);
      throw error;
    } finally {
      this.readerReadPending = false;
      if (this.failure) {
        this.release();
      }
    }

    this.throwIfFailed();

    if (result.done) {
      if (allowEof) {
        return false;
      }

      const error = new Error('Multipart body ended before its closing boundary.');
      this.fail(error);
      throw error;
    }

    const chunk = result.value;
    this.totalSize += chunk.byteLength;

    if (this.totalSize > this.maxTotalSize) {
      this.fail(new PayloadTooLargeException(
        `${MULTIPART_BODY_LIMIT_MESSAGE} ${String(this.maxTotalSize)} bytes.`,
      ));
      this.throwIfFailed();
    }

    this.buffer = concatBytes([this.buffer, chunk], this.buffer.byteLength + chunk.byteLength);
    return true;
  }

  private consume(size: number): Uint8Array {
    const value = this.buffer.slice(0, size);
    this.buffer = this.buffer.slice(size);
    return value;
  }

  private async drainAfterClosingBoundary(): Promise<void> {
    if (this.terminalDrained) {
      return;
    }

    while (true) {
      this.buffer = new Uint8Array();

      if (!await this.readMore(true)) {
        this.terminalDrained = true;
        this.release();
        return;
      }
    }
  }

  private fail(reason: unknown): void {
    if (this.failure) {
      return;
    }

    const error = toError(reason);
    this.failure = error;
    this.done = true;
    this.fileController?.error(error);
    this.fileController = undefined;
    this.activeFile = false;
    this.signal?.removeEventListener('abort', this.handleAbort);

    if (!this.cancellationStarted) {
      this.cancellationStarted = true;
      void this.reader.cancel(reason).then(
        () => this.release(),
        () => this.release(),
      );
    }

    this.release();
  }

  private release(): void {
    if (this.released || this.readerReadPending) {
      return;
    }

    this.released = true;
    this.signal?.removeEventListener('abort', this.handleAbort);
    this.reader.releaseLock();
  }

  private throwIfFailed(): void {
    if (this.failure) {
      throw this.failure;
    }
  }
}

function extractMultipartBoundary(contentType: string | null): string {
  const match = contentType?.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] ?? match?.[2]?.trim();

  if (!boundary) {
    throw new Error('Multipart requests require a boundary parameter.');
  }

  return boundary;
}

function parseContentDisposition(value: string | undefined): { filename?: string; name: string } {
  if (!value?.toLowerCase().startsWith('form-data')) {
    throw new Error('Multipart parts require a form-data Content-Disposition header.');
  }

  const name = value.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];

  if (name === undefined) {
    throw new Error('Multipart parts require a name parameter.');
  }

  return {
    filename: value.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1],
    name,
  };
}

function resolveMultipartStreamBody(request: Request | MultipartRequestLike): ReadableStream<Uint8Array> {
  if (request instanceof Request) {
    if (!request.body) {
      throw new Error('Multipart requests require a body.');
    }

    return request.body;
  }

  const body = request.body ?? (
    typeof request[Symbol.asyncIterator] === 'function' ? request as AsyncIterable<Uint8Array> : undefined
  );

  if (body instanceof ReadableStream) {
    return body;
  }

  if (body && isAsyncIterableBody(body)) {
    return createReadableStreamFromAsyncIterable(body);
  }

  if (body === undefined || body === null) {
    throw new Error('Multipart requests require a body.');
  }

  const converted = new Request(request.url ?? 'http://localhost/', {
    body: body as BodyInit,
    method: request.method ?? 'POST',
  }).body;

  if (!converted) {
    throw new Error('Multipart requests require a body.');
  }

  return converted;
}

function getContentLengthError(headers: Headers, maxTotalSize: number): PayloadTooLargeException | undefined {
  const contentLength = headers.get('content-length');

  if (contentLength === null) {
    return undefined;
  }

  const parsedContentLength = Number(contentLength);

  if (Number.isFinite(parsedContentLength) && parsedContentLength > maxTotalSize) {
    return new PayloadTooLargeException(`${MULTIPART_BODY_LIMIT_MESSAGE} ${String(maxTotalSize)} bytes.`);
  }

  return undefined;
}

function indexOfBytes(input: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0 || needle.byteLength > input.byteLength) {
    return -1;
  }

  outer: for (let index = 0; index <= input.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (input[index + offset] !== needle[offset]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function matchesAt(input: Uint8Array, needle: Uint8Array, start: number): boolean {
  if (start + needle.byteLength > input.byteLength) {
    return false;
  }

  for (let offset = 0; offset < needle.byteLength; offset += 1) {
    if (input[start + offset] !== needle[offset]) {
      return false;
    }
  }

  return true;
}

function equalsBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && matchesAt(left, right, 0);
}

function concatBytes(
  chunks: readonly Uint8Array<ArrayBufferLike>[],
  size: number,
): Uint8Array<ArrayBufferLike> {
  const result = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function trailingDelimiterPrefixLength(buffer: Uint8Array, delimiter: Uint8Array): number {
  const maximum = Math.min(buffer.byteLength, delimiter.byteLength - 1);

  for (let size = maximum; size > 0; size -= 1) {
    if (equalsBytes(buffer.slice(buffer.byteLength - size), delimiter.slice(0, size))) {
      return size;
    }
  }

  return 0;
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Multipart request was aborted.');
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  }, { highWaterMark: 0 });
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
