import { BadRequestException, PayloadTooLargeException } from '@fluojs/http';

const DECODER = new TextDecoder();

/**
 * Extracts the declared multipart boundary from a content type header.
 *
 * @param contentType - Full multipart content type header.
 * @returns The unquoted multipart boundary.
 */
export function parseBoundary(contentType: string): string {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];

  if (!boundary) {
    throw new BadRequestException('Multipart content type is missing a boundary.');
  }

  return boundary;
}

/**
 * Parses and normalizes one bounded multipart header block.
 *
 * @param bytes - Encoded header bytes without the terminating empty line.
 * @param maxHeaders - Maximum allowed header line count.
 * @returns Lowercase multipart part headers.
 */
export function parseHeaders(
  bytes: Uint8Array,
  maxHeaders: number,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  let headerCount = 0;

  for (const line of DECODER.decode(bytes).split('\r\n')) {
    headerCount += 1;

    if (headerCount > maxHeaders) {
      throw new PayloadTooLargeException(
        `Multipart part exceeds the maximum header count of ${String(maxHeaders)}.`,
      );
    }

    const separator = line.indexOf(':');

    if (separator <= 0) {
      throw new BadRequestException('Multipart part contains a malformed header.');
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }

  return headers;
}

/**
 * Parses form-data name and optional filename parameters.
 *
 * @param value - Content-Disposition header value.
 * @returns Parsed field name and optional original filename.
 */
export function parseContentDisposition(
  value: string | undefined,
): { filename?: string; name: string } {
  if (!value || !/^form-data(?:;|$)/i.test(value)) {
    throw new BadRequestException('Multipart part requires a form-data content disposition.');
  }

  const parameters = new Map<string, string>();
  const pattern = /;\s*([^=;\s]+)=(?:"((?:\\.|[^"])*)"|([^;\s]*))/g;

  for (const match of value.matchAll(pattern)) {
    parameters.set(match[1]!.toLowerCase(), (match[2] ?? match[3] ?? '').replace(/\\"/g, '"'));
  }

  const name = parameters.get('name');

  if (!name) {
    throw new BadRequestException('Multipart content disposition requires a field name.');
  }

  const filename = parameters.get('filename');
  return filename === undefined ? { name } : { filename, name };
}

/**
 * Adapts a portable async byte iterable to a Web readable stream.
 *
 * @param body - Existing Web stream or async byte iterable.
 * @returns A cancellation-aware Web byte stream.
 */
export function toReadableStream(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) {
    return body;
  }

  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    cancel: async () => {
      await iterator.return?.();
    },
    pull: async (controller) => {
      const result = await iterator.next();
      result.done ? controller.close() : controller.enqueue(result.value);
    },
  });
}

/**
 * Compares two byte arrays for exact equality.
 *
 * @param left - First byte array.
 * @param right - Second byte array.
 * @returns `true` when both arrays contain identical bytes.
 */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

/**
 * Concatenates buffered byte chunks in encounter order.
 *
 * @param chunks - Byte chunks to concatenate.
 * @returns One contiguous byte array.
 */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}
