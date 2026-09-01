import { readFirstNonEmptyRequestHeaderValue } from './header-helpers.js';
import type { FrameworkRequest, FrameworkResponse, FrameworkResponseStream, ResponseValidators } from './types.js';
import { matchesIfRange } from './dispatch/conditional-request-policy.js';
import {
  registerFrameworkResponseWriter,
  type FrameworkResponseWriterContext,
} from './dispatch/response-integration.js';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

type ByteRangeSource = (
  | (() => ReadableStream<Uint8Array>)
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | Uint8Array
);

type ResolvedByteRange =
  | { readonly kind: 'full' }
  | { readonly end: number; readonly kind: 'partial'; readonly start: number }
  | { readonly kind: 'unsatisfiable' };

/**
 * Input accepted by {@link createByteRangeResponse}.
 *
 * A streamed representation needs its exact full byte length so the response
 * can evaluate `Range`, `If-Range`, and `HEAD` before consuming the stream.
 * Pass a stream factory when `HEAD` must not construct the stream.
 */
export type ByteRangeResponseSource = ByteRangeSource;

/** Options that describe a range-capable byte representation. */
export interface ByteRangeResponseOptions {
  /** Media type emitted when route metadata did not already choose one. */
  readonly contentType?: string;
  /** Exact representation size in bytes. Required for a `ReadableStream` source. */
  readonly size?: number;
}

/**
 * Creates a response entry with RFC single-byte-range semantics.
 *
 * `Uint8Array` and `ArrayBuffer` values can be returned directly from a
 * handler. Use this helper when returning a portable `ReadableStream`.
 */
export function createByteRangeResponse(
  source: ByteRangeResponseSource,
  options: ByteRangeResponseOptions = {},
): object {
  const bytes = toBytes(source);
  const size = bytes?.byteLength ?? options.size;

  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new TypeError('A readable byte-range response requires a non-negative integer size.');
  }

  return registerFrameworkResponseWriter(
    { source, contentType: options.contentType ?? DEFAULT_CONTENT_TYPE, size },
    writeByteRangeResponse,
  );
}

/** Returns whether a normal handler result is an automatically range-capable byte value. */
export function isByteRangeByteSource(value: unknown): value is ArrayBuffer | Uint8Array {
  return value instanceof ArrayBuffer || value instanceof Uint8Array;
}

/**
 * Determines whether an ordinary byte result requires byte-range processing.
 *
 * Explicit byte-range responses retain their full-response metadata behavior;
 * this only guards automatic range handling for plain handler values.
 */
export function shouldApplyByteRange(
  request: FrameworkRequest,
  validators: ResponseValidators | undefined,
): boolean {
  return parseByteRangeHeader(readFirstNonEmptyRequestHeaderValue(request, 'range')) !== undefined
    && matchesIfRange(request, validators);
}

function resolveByteRange(
  rangeHeader: string | undefined,
  size: number,
  ifRangeMatches: boolean,
): ResolvedByteRange {
  const match = parseByteRangeHeader(rangeHeader);

  if (!match || !ifRangeMatches) {
    return { kind: 'full' };
  }

  const [, startText, endText] = match;

  if ((startText?.length ?? 0) === 0) {
    const suffixLength = Number(endText);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) {
      return { kind: 'unsatisfiable' };
    }

    return {
      end: size - 1,
      kind: 'partial',
      start: Math.max(size - suffixLength, 0),
    };
  }

  const start = Number(startText);

  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { kind: 'unsatisfiable' };
  }

  if ((endText?.length ?? 0) === 0) {
    return { end: size - 1, kind: 'partial', start };
  }

  const requestedEnd = Number(endText);

  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { kind: 'unsatisfiable' };
  }

  return { end: Math.min(requestedEnd, size - 1), kind: 'partial', start };
}

function parseByteRangeHeader(rangeHeader: string | undefined): RegExpExecArray | undefined {
  if (!rangeHeader) {
    return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  return match && (match[1]?.length ?? 0) + (match[2]?.length ?? 0) > 0
    ? match
    : undefined;
}

async function writeByteRangeResponse(
  context: FrameworkResponseWriterContext,
): Promise<void> {
  const entry = context.value as {
    readonly contentType: string;
    readonly size: number;
    readonly source: ByteRangeResponseSource;
  };
  const response = context.response;

  if (response.committed) {
    return;
  }

  context.applySuccessResponseMetadata();
  response.setHeader('Accept-Ranges', 'bytes');

  if (!hasHeader(response, 'content-type')) {
    response.setHeader('Content-Type', entry.contentType);
  }

  const range = resolveByteRange(
    readFirstNonEmptyRequestHeaderValue(context.request, 'range'),
    entry.size,
    matchesIfRange(context.request, context.validators),
  );

  if (range.kind === 'unsatisfiable') {
    response.setStatus(416);
    response.setHeader('Content-Length', '0');
    response.setHeader('Content-Range', `bytes */${entry.size}`);
    await response.send(undefined);
    return;
  }

  if (range.kind === 'partial') {
    response.setStatus(206);
    response.setHeader('Content-Length', String(range.end - range.start + 1));
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${entry.size}`);
  } else {
    response.setHeader('Content-Length', String(entry.size));
  }

  if (context.request.method.toUpperCase() === 'HEAD') {
    await response.send(undefined);
    return;
  }

  const bytes = toBytes(entry.source);

  if (bytes) {
    await response.send(range.kind === 'partial' ? bytes.slice(range.start, range.end + 1) : bytes);
    return;
  }

  const streamSource = openByteRangeStream(entry.source);

  if (!streamSource) {
    throw new TypeError('A byte-range response must contain bytes or a portable readable stream.');
  }

  await writeReadableStream(
    streamSource,
    range.kind === 'partial' ? range.start : 0,
    range.kind === 'partial' ? range.end : entry.size - 1,
    context.request,
    response,
  );
}

function hasHeader(response: FrameworkResponse, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(response.headers).some((header) => header.toLowerCase() === lowerName);
}

function toBytes(source: ByteRangeResponseSource): Uint8Array | undefined {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }

  return undefined;
}

function isReadableStream(source: ByteRangeResponseSource): source is ReadableStream<Uint8Array> {
  return typeof source === 'object' && source !== null && 'getReader' in source;
}

function openByteRangeStream(source: ByteRangeResponseSource): ReadableStream<Uint8Array> | undefined {
  const stream = typeof source === 'function' ? source() : source;
  return isReadableStream(stream) ? stream : undefined;
}

async function writeReadableStream(
  source: ReadableStream<Uint8Array>,
  start: number,
  end: number,
  request: FrameworkRequest,
  response: FrameworkResponse,
): Promise<void> {
  const stream = response.stream;

  if (!stream) {
    throw new TypeError('The active HTTP adapter cannot write a portable byte stream.');
  }

  const reader = source.getReader();
  let skip = start;
  let remaining = end - start + 1;
  let closed = false;

  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    void reader.cancel();
  };
  const removeCloseListener = stream.onClose?.(close);
  request.signal?.addEventListener('abort', close, { once: true });
  response.committed = true;

  try {
    while (remaining > 0 && !closed && !stream.closed) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (skip >= value.byteLength) {
        skip -= value.byteLength;
        continue;
      }

      const chunkStart = skip;
      skip = 0;
      const chunkEnd = Math.min(value.byteLength, chunkStart + remaining);
      const chunk = value.subarray(chunkStart, chunkEnd);
      remaining -= chunk.byteLength;

      if (chunk.byteLength > 0 && stream.write(chunk) === false) {
        await stream.waitForDrain?.();
      }
    }
  } finally {
    request.signal?.removeEventListener('abort', close);
    removeCloseListener?.();
    close();

    if (!stream.closed) {
      stream.close();
    }
  }
}
