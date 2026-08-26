import { BadRequestException, PayloadTooLargeException } from '@fluojs/http';

const EMPTY_BYTES = new Uint8Array();
const SUFFIX_PAGE_SIZE = 8 * 1024;
const TOTAL_LIMIT_MESSAGE = 'Multipart body exceeds the maximum size of';

class MultipartBytePages {
  private readonly pages: Uint8Array[] = [];
  private size = 0;

  get byteLength(): number {
    return this.size;
  }

  append(bytes: Uint8Array): void {
    let sourceOffset = 0;

    while (sourceOffset < bytes.byteLength) {
      const pageOffset = this.size % SUFFIX_PAGE_SIZE;
      let page = this.pages[this.pages.length - 1];

      if (page === undefined || pageOffset === 0) {
        page = new Uint8Array(SUFFIX_PAGE_SIZE);
        this.pages.push(page);
      }

      const length = Math.min(SUFFIX_PAGE_SIZE - pageOffset, bytes.byteLength - sourceOffset);

      if (length === 1) {
        page[pageOffset] = bytes[sourceOffset]!;
      } else {
        page.set(bytes.subarray(sourceOffset, sourceOffset + length), pageOffset);
      }

      sourceOffset += length;
      this.size += length;
    }
  }

  byteAt(offset: number): number {
    return this.pages[Math.floor(offset / SUFFIX_PAGE_SIZE)]![offset % SUFFIX_PAGE_SIZE]!;
  }

  segments(start = 0, end = this.size): Uint8Array[] {
    const segments: Uint8Array[] = [];

    while (start < end) {
      const pageOffset = start % SUFFIX_PAGE_SIZE;
      const length = Math.min(SUFFIX_PAGE_SIZE - pageOffset, end - start);
      segments.push(this.pages[Math.floor(start / SUFFIX_PAGE_SIZE)]!.subarray(pageOffset, pageOffset + length));
      start += length;
    }

    return segments;
  }
}

interface MultipartBodyChunk {
  boundary: boolean;
  bytes: Uint8Array;
}

interface MultipartBodyReadOptions {
  maxBytes?: number;
}

interface MultipartBoundarySuffix {
  closing: boolean;
  length: number;
}

interface MultipartBoundarySuffixScan {
  invalidLength?: number;
  sourceBytes: MultipartBytePages;
  suffix?: MultipartBoundarySuffix;
}

/** Pull-driven byte reader that bounds multipart lookbehind and total encoded size. */
export class MultipartByteReader {
  private buffer: Uint8Array = EMPTY_BYTES;
  private cancelled = false;
  private literalHead = 0;
  private literalOffset = 0;
  private readonly literalSegments: Uint8Array[] = [];
  private completed = false;
  private cancellation: Promise<void> | undefined;
  private fatalError: unknown;
  private released = false;
  private readInFlight: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  private totalSize = 0;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly abortListener: () => void;

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly maxTotalSize: number,
    private readonly signal?: AbortSignal,
    private readonly cancelSource = true,
    private readonly onSourceReleased?: () => void,
  ) {
    this.reader = stream.getReader();
    this.abortListener = () => {
      const reason = this.signal?.reason ?? new DOMException('The request was aborted.', 'AbortError');
      this.fatalError = reason;
      void this.cancel(reason);
    };

    if (signal?.aborted) {
      this.abortListener();
    } else {
      signal?.addEventListener('abort', this.abortListener, { once: true });
    }
  }

  async cancel(reason?: unknown): Promise<void> {
    if (this.completed) {
      return;
    }

    if (this.cancellation) {
      await this.cancellation;
      return;
    }

    if (reason !== undefined && this.fatalError === undefined) {
      this.fatalError = reason instanceof Error
        ? reason
        : new DOMException(String(reason), 'AbortError');
    }

    this.cancelled = true;
    this.signal?.removeEventListener('abort', this.abortListener);
    this.cancellation = this.cancelReader(reason);
    await this.cancellation;
  }

  private async cancelReader(reason?: unknown): Promise<void> {
    if (!this.cancelSource) {
      try {
        await this.readInFlight;
      } catch {
        // The parser cancellation reason remains the observable failure.
      }

      this.releaseReader();
      return;
    }

    try {
      await this.reader.cancel(reason);
    } catch {
      // The original parser, limit, or abort error remains the observable failure.
    } finally {
      this.releaseReader();
    }
  }

  async complete(): Promise<void> {
    this.buffer = EMPTY_BYTES;

    while (!this.cancelled) {
      const result = await this.readSource(false);

      if (result.done) {
        this.completed = true;
        this.signal?.removeEventListener('abort', this.abortListener);
        this.releaseReader();
        return;
      }
    }
  }

  async readBytes(length: number): Promise<Uint8Array> {
    while (this.buffer.byteLength < length) {
      const result = await this.readSource();

      if (result.done) {
        throw new BadRequestException('Multipart body ended unexpectedly.');
      }
    }

    const bytes = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return bytes;
  }

  async skipPreamble(
    initialBoundary: Uint8Array,
    bodyBoundary: Uint8Array,
  ): Promise<void> {
    while (this.buffer.byteLength < initialBoundary.byteLength) {
      const result = await this.readSource();

      if (result.done) {
        throw new BadRequestException('Multipart body ended before the initial boundary.');
      }
    }

    if (
      findBytes(this.buffer, initialBoundary) === 0
      && await this.hasLegalBoundarySuffix(initialBoundary.byteLength)
    ) {
      this.buffer = this.buffer.slice(initialBoundary.byteLength);
      return;
    }

    for (;;) {
      const chunk = await this.readBodyChunk(bodyBoundary);

      if (chunk.boundary) {
        return;
      }
    }
  }

  async readUntil(delimiter: Uint8Array, maxLength?: number): Promise<Uint8Array> {
    for (;;) {
      const index = findBytes(this.buffer, delimiter);

      if (index >= 0) {
        if (maxLength !== undefined && index > maxLength) {
          throwHeaderLimit(maxLength);
        }

        const bytes = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + delimiter.byteLength);
        return bytes;
      }

      if (maxLength !== undefined && this.buffer.byteLength > maxLength + delimiter.byteLength) {
        throwHeaderLimit(maxLength);
      }

      const result = await this.readSource();

      if (result.done) {
        throw new BadRequestException('Multipart body ended before a required delimiter.');
      }
    }
  }

  async readBodyChunk(
    delimiter: Uint8Array,
    options: MultipartBodyReadOptions = {},
  ): Promise<MultipartBodyChunk> {
    const literal = this.readLiteralBytes(options.maxBytes);

    if (literal) {
      return { boundary: false, bytes: literal };
    }

    for (;;) {
      const index = findBytes(this.buffer, delimiter);

      if (index >= 0) {
        if (options.maxBytes !== undefined && index > options.maxBytes) {
          return { boundary: false, bytes: this.takeBufferBytes(options.maxBytes + 1) };
        }

        const suffixOffset = index + delimiter.byteLength;
        const scan = await this.readBoundarySuffix(suffixOffset);

        if (!scan.suffix) {
          return this.queueInvalidBoundary(index, suffixOffset, scan, options.maxBytes);
        }

        this.appendSourcePages(scan.sourceBytes);
        const bytes = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + delimiter.byteLength);
        return { boundary: true, bytes };
      }

      const retainedSize = Math.max(0, delimiter.byteLength - 1);

      if (this.buffer.byteLength > retainedSize) {
        const splitAt = this.buffer.byteLength - retainedSize;
        const bytes = this.buffer.slice(0, splitAt);
        this.buffer = this.buffer.slice(splitAt);
        return { boundary: false, bytes };
      }

      const result = await this.readSource();

      if (result.done) {
        throw new BadRequestException('Multipart body ended before the closing boundary.');
      }
    }
  }

  async consumeBoundarySuffix(): Promise<boolean> {
    const scan = await this.readBoundarySuffix(0);
    this.appendSourcePages(scan.sourceBytes);

    if (!scan.suffix) {
      throw new BadRequestException('Multipart boundary has an invalid terminator.');
    }

    this.buffer = this.buffer.slice(scan.suffix.length);
    return scan.suffix.closing;
  }

  private async hasLegalBoundarySuffix(offset: number): Promise<boolean> {
    const scan = await this.readBoundarySuffix(offset);
    this.appendSourcePages(scan.sourceBytes);
    return scan.suffix !== undefined;
  }

  private async readBoundarySuffix(offset: number): Promise<MultipartBoundarySuffixScan> {
    const baseLength = this.buffer.byteLength;
    const sourceBytes = new MultipartBytePages();
    let closing = false;
    let cursor = offset;

    const readByte = async (byteOffset: number): Promise<number | undefined> => {
      while (baseLength + sourceBytes.byteLength <= byteOffset) {
        const result = await this.readSource(false);

        if (result.done) {
          return undefined;
        }

        if (result.value.byteLength > 0) {
          sourceBytes.append(result.value);
        }
      }

      return byteOffset < baseLength
        ? this.buffer[byteOffset]
        : sourceBytes.byteAt(byteOffset - baseLength);
    };

    const invalid = (length: number): MultipartBoundarySuffixScan => ({
      invalidLength: length,
      sourceBytes,
    });
    const first = await readByte(cursor);

    if (first === 45) {
      if (await readByte(cursor + 1) !== 45) {
        return invalid(1);
      }

      closing = true;
      cursor += 2;
    }

    for (;;) {
      const byte = await readByte(cursor);

      if (byte === undefined) {
        if (closing) {
          return {
            sourceBytes,
            suffix: { closing, length: cursor - offset },
          };
        }

        return invalid(cursor - offset);
      }

      if (byte === 32 || byte === 9) {
        cursor += 1;
        continue;
      }

      if (byte !== 13) {
        return invalid(cursor + 1 - offset);
      }

      const lineFeed = await readByte(cursor + 1);

      if (lineFeed !== 10) {
        return invalid(cursor + (lineFeed === undefined ? 1 : 2) - offset);
      }

      return {
        sourceBytes,
        suffix: {
          closing,
          length: cursor + 2 - offset,
        },
      };
    }
  }

  private queueInvalidBoundary(
    index: number,
    suffixOffset: number,
    scan: MultipartBoundarySuffixScan,
    maxBytes: number | undefined,
  ): MultipartBodyChunk {
    const literalEnd = suffixOffset + (scan.invalidLength ?? 0);
    const baseLiteralEnd = Math.min(literalEnd, this.buffer.byteLength);
    const prefix = this.buffer.slice(0, index);
    const literalSegments: Uint8Array[] = [];

    if (index < baseLiteralEnd) {
      literalSegments.push(this.buffer.slice(index, baseLiteralEnd));
    }

    const literalSourceBytes = Math.max(0, literalEnd - this.buffer.byteLength);

    literalSegments.push(...scan.sourceBytes.segments(0, literalSourceBytes));
    this.buffer = this.buffer.slice(baseLiteralEnd);
    this.appendSourceSegments(scan.sourceBytes.segments(literalSourceBytes));
    this.appendLiteralSegments(literalSegments);

    if (prefix.byteLength > 0) {
      return { boundary: false, bytes: prefix };
    }

    return {
      boundary: false,
      bytes: this.readLiteralBytes(maxBytes)!,
    };
  }

  private appendLiteralSegments(segments: readonly Uint8Array[]): void {
    for (const segment of segments) {
      if (segment.byteLength > 0) {
        this.literalSegments.push(segment);
      }
    }
  }

  private readLiteralBytes(maxBytes: number | undefined): Uint8Array | undefined {
    if (this.literalHead === this.literalSegments.length) {
      return undefined;
    }

    const limit = maxBytes === undefined ? 8 * 1024 : Math.max(1, maxBytes + 1);
    const first = this.literalSegments[this.literalHead]!.subarray(this.literalOffset);

    if (first.byteLength >= limit) {
      const bytes = first.subarray(0, limit);
      this.advanceLiteralBytes(limit);
      return bytes;
    }

    let available = first.byteLength;
    let index = this.literalHead + 1;

    while (available < limit && index < this.literalSegments.length) {
      available += this.literalSegments[index]!.byteLength;
      index += 1;
    }

    const length = Math.min(available, limit);
    const bytes = new Uint8Array(length);
    let destination = 0;
    let remaining = length;

    while (remaining > 0) {
      const segment = this.literalSegments[this.literalHead]!.subarray(this.literalOffset);
      const size = Math.min(segment.byteLength, remaining);
      bytes.set(segment.subarray(0, size), destination);
      destination += size;
      remaining -= size;
      this.advanceLiteralBytes(size);
    }

    return bytes;
  }

  private advanceLiteralBytes(length: number): void {
    let remaining = length;

    while (remaining > 0) {
      const segment = this.literalSegments[this.literalHead]!;
      const available = segment.byteLength - this.literalOffset;

      if (remaining < available) {
        this.literalOffset += remaining;
        return;
      }

      remaining -= available;
      this.literalHead += 1;
      this.literalOffset = 0;
    }

    if (this.literalHead === this.literalSegments.length) {
      this.literalSegments.length = 0;
      this.literalHead = 0;
    }
  }

  private takeBufferBytes(length: number): Uint8Array {
    const bytes = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return bytes;
  }

  private appendSourcePages(sourceBytes: MultipartBytePages): void {
    this.appendSourceSegments(sourceBytes.segments());
  }

  private appendSourceSegments(chunks: readonly Uint8Array[]): void {
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);

    if (size === 0) {
      return;
    }

    const bytes = new Uint8Array(this.buffer.byteLength + size);
    bytes.set(this.buffer);
    let offset = this.buffer.byteLength;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.buffer = bytes;
  }

  private async readSource(appendToBuffer = true): Promise<ReadableStreamReadResult<Uint8Array>> {
    this.throwIfFailed();
    const read = this.reader.read();
    this.readInFlight = read;
    let result: ReadableStreamReadResult<Uint8Array>;

    try {
      result = await read;
    } finally {
      if (this.readInFlight === read) {
        this.readInFlight = undefined;
      }

    }

    this.throwIfFailed();

    if (result.done) {
      return result;
    }

    this.totalSize += result.value.byteLength;

    if (this.totalSize > this.maxTotalSize) {
      const error = new PayloadTooLargeException(
        `${TOTAL_LIMIT_MESSAGE} ${String(this.maxTotalSize)} bytes.`,
      );
      this.fatalError = error;
      await this.cancel(error);
      throw error;
    }

    if (appendToBuffer) {
      this.buffer = concatBytes(this.buffer, result.value);
    }

    return result;
  }

  private throwIfFailed(): void {
    if (this.fatalError !== undefined) {
      throw this.fatalError;
    }
  }

  private releaseReader(): void {
    if (this.released) {
      return;
    }

    this.reader.releaseLock();
    this.released = true;
    this.onSourceReleased?.();
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) {
    return right;
  }

  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function throwHeaderLimit(maxHeaderSize: number): never {
  throw new PayloadTooLargeException(
    `Multipart part headers exceed the maximum size of ${String(maxHeaderSize)} bytes.`,
  );
}
