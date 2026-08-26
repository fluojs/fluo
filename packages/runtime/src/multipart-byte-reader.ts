import { BadRequestException, PayloadTooLargeException } from '@fluojs/http';

const EMPTY_BYTES = new Uint8Array();
const TOTAL_LIMIT_MESSAGE = 'Multipart body exceeds the maximum size of';

interface MultipartBodyChunk {
  boundary: boolean;
  bytes: Uint8Array;
}

interface MultipartBoundarySuffix {
  closing: boolean;
  length: number;
}

/** Pull-driven byte reader that bounds multipart lookbehind and total encoded size. */
export class MultipartByteReader {
  private buffer: Uint8Array = EMPTY_BYTES;
  private cancelled = false;
  private completed = false;
  private cancellation: Promise<void> | undefined;
  private fatalError: unknown;
  private released = false;
  private totalSize = 0;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly abortListener: () => void;

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly maxTotalSize: number,
    private readonly signal?: AbortSignal,
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
    while (this.buffer.byteLength < initialBoundary.byteLength + 2) {
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

  async readBodyChunk(delimiter: Uint8Array): Promise<MultipartBodyChunk> {
    for (;;) {
      const index = findBytes(this.buffer, delimiter);

      if (index >= 0) {
        const suffixOffset = index + delimiter.byteLength;

        while (this.buffer.byteLength < suffixOffset + 2) {
          const result = await this.readSource();

          if (result.done) {
            const bytes = this.buffer.slice(0, index + 1);
            this.buffer = this.buffer.slice(index + 1);
            return { boundary: false, bytes };
          }
        }

        if (!await this.hasLegalBoundarySuffix(suffixOffset)) {
          const bytes = this.buffer.slice(0, index + 1);
          this.buffer = this.buffer.slice(index + 1);
          return { boundary: false, bytes };
        }

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
    const suffix = await this.readBoundarySuffix(0);

    if (!suffix) {
      throw new BadRequestException('Multipart boundary has an invalid terminator.');
    }

    this.buffer = this.buffer.slice(suffix.length);
    return suffix.closing;
  }

  private async hasLegalBoundarySuffix(offset: number): Promise<boolean> {
    return await this.readBoundarySuffix(offset) !== undefined;
  }

  private async readBoundarySuffix(offset: number): Promise<MultipartBoundarySuffix | undefined> {
    let closing = false;
    let cursor = offset;
    const first = await this.readBoundaryByte(cursor);

    if (first === 45) {
      if (await this.readBoundaryByte(cursor + 1) !== 45) {
        return undefined;
      }

      closing = true;
      cursor += 2;
    }

    for (;;) {
      const byte = await this.readBoundaryByte(cursor);

      if (byte === undefined) {
        return closing && cursor === offset + 2
          ? { closing, length: cursor - offset }
          : undefined;
      }

      if (byte === 32 || byte === 9) {
        cursor += 1;
        continue;
      }

      if (byte !== 13 || await this.readBoundaryByte(cursor + 1) !== 10) {
        return undefined;
      }

      return {
        closing,
        length: cursor + 2 - offset,
      };
    }
  }

  private async readBoundaryByte(offset: number): Promise<number | undefined> {
    while (this.buffer.byteLength <= offset) {
      const result = await this.readSource();

      if (result.done) {
        return undefined;
      }
    }

    return this.buffer[offset];
  }

  private async readSource(appendToBuffer = true): Promise<ReadableStreamReadResult<Uint8Array>> {
    this.throwIfFailed();
    const result = await this.reader.read();
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
