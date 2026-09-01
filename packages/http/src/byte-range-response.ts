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

/** Internal byte-representation data shared by response writers. */
export interface ByteRangeResponseEntry {
  readonly contentType: string;
  readonly size: number;
  readonly source: ByteRangeResponseSource;
}

/** Inputs for writing a byte representation through a portable response facade. */
export interface ByteRangeResponseWriteOptions {
  readonly applySuccessResponseMetadata: () => void;
  /** Whether adapter-owned dynamic compression may transform byte-backed responses. */
  readonly compression?: boolean;
  readonly entry: ByteRangeResponseEntry;
  readonly request: FrameworkRequest;
  readonly response: FrameworkResponse;
  readonly validators: ResponseValidators | undefined;
}

/**
 * Creates a response entry with RFC single-byte-range semantics.
 *
 * `Uint8Array` and `ArrayBuffer` values can be returned directly from a
 * handler. Use this helper when returning a portable `ReadableStream`.
 *
 * @param source Byte representation or stream factory to expose with range support.
 * @param options Optional content type and required stream size metadata.
 * @returns A registered response entry that applies single-byte-range semantics.
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

  const entry: ByteRangeResponseEntry = {
    source,
    contentType: options.contentType ?? DEFAULT_CONTENT_TYPE,
    size,
  };

  return registerFrameworkResponseWriter(entry, async (context) => {
    await writeByteRangeResponse({
      applySuccessResponseMetadata: context.applySuccessResponseMetadata,
      entry,
      request: context.request,
      response: context.response,
      validators: context.validators,
    });
  });
}

/**
 * Returns whether a normal handler result is an automatically range-capable byte value.
 *
 * @param value Value to test for a byte representation.
 * @returns `true` when the value is an `ArrayBuffer` or `Uint8Array`; otherwise `false`.
 */
export function isByteRangeByteSource(value: unknown): value is ArrayBuffer | Uint8Array {
  return value instanceof ArrayBuffer || value instanceof Uint8Array;
}

/**
 * Determines whether an ordinary byte result requires byte-range processing.
 *
 * Explicit byte-range responses retain their full-response metadata behavior;
 * this only guards automatic range handling for plain handler values.
 *
 * @param request Incoming request whose `Range` and `If-Range` fields are evaluated.
 * @param validators Selected response validators used to evaluate `If-Range`.
 * @returns `true` when the request has a valid byte range and `If-Range` permits it.
 */
export function shouldApplyByteRange(
  request: FrameworkRequest,
  validators: ResponseValidators | undefined,
): boolean {
  return isByteRangeRequestMethod(request.method)
    && parseByteRangeHeader(readFirstNonEmptyRequestHeaderValue(request, 'range')) !== undefined
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

/**
 * Writes one byte representation while preserving range and cancellation semantics.
 *
 * @param options Request, response, validators, and representation metadata.
 * @returns A promise that settles after the representation completes or fails.
 */
export async function writeByteRangeResponse(
  options: ByteRangeResponseWriteOptions,
): Promise<void> {
  const { entry, request, response, validators } = options;

  if (response.committed) {
    return;
  }

  const acceptsByteRange = isByteRangeRequestMethod(request.method);
  const range = resolveByteRange(
    acceptsByteRange
      ? readFirstNonEmptyRequestHeaderValue(request, 'range')
      : undefined,
    entry.size,
    acceptsByteRange && matchesIfRange(request, validators),
  );
  const isHead = request.method.toUpperCase() === 'HEAD';
  const bytes = toBytes(entry.source);

  if (range.kind === 'unsatisfiable') {
    options.applySuccessResponseMetadata();

    if (acceptsByteRange) {
      response.setHeader('Accept-Ranges', 'bytes');
    }

    if (!hasHeader(response, 'content-type')) {
      response.setHeader('Content-Type', entry.contentType);
    }

    response.setStatus(416);
    response.setHeader('Content-Length', '0');
    response.setHeader('Content-Range', `bytes */${entry.size}`);
    await response.send(undefined, sendOptions(options.compression));
    return;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stream: FrameworkResponseStream | undefined;

  if (!isHead && !bytes) {
    const streamSource = openByteRangeStream(entry.source);

    if (!streamSource) {
      throw new TypeError('A byte-range response must contain bytes or a portable readable stream.');
    }

    reader = streamSource.getReader();

    try {
      stream = response.stream;
    } catch (error) {
      await cancelAndReleaseReader(reader);
      throw error;
    }

    if (!stream) {
      await cancelAndReleaseReader(reader);
      throw new TypeError('The active HTTP adapter cannot write a portable byte stream.');
    }
  }

  options.applySuccessResponseMetadata();

  if (acceptsByteRange) {
    response.setHeader('Accept-Ranges', 'bytes');
  }

  if (!hasHeader(response, 'content-type')) {
    response.setHeader('Content-Type', entry.contentType);
  }

  if (range.kind === 'partial') {
    response.setStatus(206);
    response.setHeader('Content-Length', String(range.end - range.start + 1));
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${entry.size}`);
  } else {
    response.setHeader('Content-Length', String(entry.size));
  }

  if (isHead) {
    await response.send(undefined, sendOptions(options.compression));
    return;
  }

  if (bytes) {
    await response.send(
      range.kind === 'partial' ? bytes.slice(range.start, range.end + 1) : bytes,
      sendOptions(options.compression),
    );
    return;
  }

  if (!reader || !stream) {
    throw new TypeError('A byte-range response must contain an opened portable readable stream.');
  }

  response.committed = true;
  await writeReadableStream(
    reader,
    range.kind === 'partial' ? range.start : 0,
    range.kind === 'partial' ? range.end : entry.size - 1,
    request,
    stream,
  );
}

function sendOptions(compression: boolean | undefined): { readonly compression: false } | undefined {
  return compression === false ? { compression: false } : undefined;
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

function isByteRangeRequestMethod(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

function isReadableStream(source: unknown): source is ReadableStream<Uint8Array> {
  return typeof source === 'object'
    && source !== null
    && 'getReader' in source
    && typeof source.getReader === 'function';
}

function openByteRangeStream(source: ByteRangeResponseSource): ReadableStream<Uint8Array> | undefined {
  const stream = typeof source === 'function' ? source() : source;
  return isReadableStream(stream) ? stream : undefined;
}

async function cancelAndReleaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  await reader.cancel().catch(() => undefined);
  reader.releaseLock();
}

async function writeReadableStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  start: number,
  end: number,
  request: FrameworkRequest,
  stream: FrameworkResponseStream,
): Promise<void> {
  let skip = start;
  let remaining = end - start + 1;
  let stopped = false;
  let transportFailure: unknown;
  let resolveStop: () => void = () => {};
  let resolveTransportFailure: () => void = () => {};
  let cancellation: Promise<void> | undefined;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const transportFailurePromise = new Promise<void>((resolve) => {
    resolveTransportFailure = resolve;
  });
  const cancel = (): Promise<void> => {
    cancellation ??= reader.cancel().catch(() => undefined);
    return cancellation;
  };
  const stop = (): void => {
    if (!stopped) {
      stopped = true;
      resolveStop();
    }

    void cancel();
  };
  const fail = (error: unknown): void => {
    if (transportFailure === undefined) {
      transportFailure = error;
      resolveTransportFailure();
    }

    stop();
  };
  const removeCloseListener = stream.onClose?.(stop);
  const removeErrorListener = stream.onError?.(fail);
  request.signal?.addEventListener('abort', stop, { once: true });

  if (isByteRangeRequestAborted(request)) {
    stop();
  }

  try {
    while (remaining > 0 && !stopped && !stream.closed) {
      if (isByteRangeRequestAborted(request)) {
        stop();
        break;
      }

      const result = await raceWithStop(reader.read(), stopPromise, transportFailurePromise);

      if (!result || stopped || transportFailure !== undefined || isByteRangeRequestAborted(request)) {
        stop();
        break;
      }

      const { done, value } = result;

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
        const drain = stream.waitForDrain?.();

        if (drain) {
          await raceWithStop(drain, stopPromise, transportFailurePromise);
        }

        if (isByteRangeRequestAborted(request)) {
          stop();
        }
      }
    }
  } finally {
    request.signal?.removeEventListener('abort', stop);
    removeCloseListener?.();
    removeErrorListener?.();

    if (stopped) {
      void cancel();
    } else {
      await cancel();
    }

    reader.releaseLock();

    if (!stream.closed && transportFailure === undefined) {
      stream.close();
    }
  }

  if (transportFailure !== undefined) {
    throw transportFailure;
  }
}

function isByteRangeRequestAborted(request: FrameworkRequest): boolean {
  return request.signal?.aborted === true || request.isAborted?.() === true;
}

async function raceWithStop<T>(
  operation: Promise<T>,
  stop: Promise<void>,
  transportFailure?: Promise<void>,
): Promise<T | undefined> {
  const terminalSignals: Promise<T | undefined>[] = [
    operation,
    stop.then(() => undefined),
  ];

  if (transportFailure) {
    terminalSignals.push(transportFailure.then(() => undefined));
  }

  return await Promise.race([
    ...terminalSignals,
  ]);
}
