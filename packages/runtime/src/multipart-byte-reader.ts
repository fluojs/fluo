import { BadRequestException, PayloadTooLargeException } from '@fluojs/http';

const EMPTY_BYTES = new Uint8Array();
const TOTAL_LIMIT_MESSAGE = 'Multipart body exceeds the maximum size of';

interface MultipartBodyChunk {
  boundary: boolean;
  bytes: Uint8Array;
}

/** Pull-driven byte reader that bounds multipart lookbehind and total encoded size. */
export class MultipartByteReader {
  private buffer: Uint8Array = EMPTY_BYTES;
  private cancelled = false;
  private completed = false;
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
    if (this.cancelled || this.completed) {
      return;
    }

    if (reason !== undefined && this.fatalError === undefined) {
      this.fatalError = reason instanceof Error
        ? reason
        : new DOMException(String(reason), 'AbortError');
    }

    this.cancelled = true;
    this.signal?.removeEventListener('abort', this.abortListener);

    try {
      await this.reader.cancel(reason);
    } catch {
      // The original parser, limit, or abort error remains the observable failure.
    } finally {
      this.releaseReader();
    }
  }

  async complete(): Promise<void> {
    this.signal?.removeEventListener('abort', this.abortListener);

    while (!this.cancelled) {
      const result = await this.readSource();

      if (result.done) {
        this.completed = true;
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

        if (!hasLegalBoundarySuffix(this.buffer, suffixOffset)) {
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

  private async readSource(): Promise<ReadableStreamReadResult<Uint8Array>> {
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

    this.buffer = concatBytes(this.buffer, result.value);
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

function hasLegalBoundarySuffix(bytes: Uint8Array, offset: number): boolean {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  return (first === 13 && second === 10) || (first === 45 && second === 45);
}

function throwHeaderLimit(maxHeaderSize: number): never {
  throw new PayloadTooLargeException(
    `Multipart part headers exceed the maximum size of ${String(maxHeaderSize)} bytes.`,
  );
}
