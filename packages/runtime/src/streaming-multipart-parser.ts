import {
  BadRequestException,
  type FrameworkMultipartFilePart,
  type FrameworkMultipartPart,
  PayloadTooLargeException,
} from '@fluojs/http';

import { MultipartByteReader } from './multipart-byte-reader.js';
import type { StreamingMultipartInput } from './streaming-multipart.js';
import {
  bytesEqual,
  concatChunks,
  parseBoundary,
  parseContentDisposition,
  parseHeaders,
  toReadableStream,
} from './streaming-multipart-utils.js';

const DEFAULT_MAX_FIELDS = 100;
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_HEADERS = 100;
const DEFAULT_MAX_HEADER_SIZE = 16 * 1024;
const DEFAULT_MAX_TOTAL_SIZE = 10 * 1024 * 1024;
const CRLF = new Uint8Array([13, 10]);
const HEADER_END = new Uint8Array([13, 10, 13, 10]);
const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/** Incremental multipart parser that exposes ordered parts and backpressure-aware file streams. */
export class StreamingMultipartParser {
  private activeFileDone: Promise<void> | undefined;
  private rejectActiveFileDone: ((error: unknown) => void) | undefined;
  private finalBoundary = false;
  private fileCount = 0;
  private fieldCount = 0;
  private initialized = false;
  private readonly bodyBoundary: Uint8Array;
  private readonly initialBoundary: Uint8Array;
  private readonly maxFields: number;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private readonly maxHeaderSize: number;
  private readonly maxHeaders: number;
  private readonly reader: MultipartByteReader;
  private readonly signal: AbortSignal | undefined;
  private readonly abortListener: (() => void) | undefined;

  constructor(input: StreamingMultipartInput) {
    const boundary = parseBoundary(input.contentType);
    const options = input.options ?? {};
    this.bodyBoundary = ENCODER.encode(`\r\n--${boundary}`);
    this.initialBoundary = ENCODER.encode(`--${boundary}`);
    this.maxFields = options.maxFields ?? DEFAULT_MAX_FIELDS;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxHeaders = options.maxHeaders ?? DEFAULT_MAX_HEADERS;
    this.maxHeaderSize = options.maxHeaderSize ?? DEFAULT_MAX_HEADER_SIZE;
    this.signal = input.signal;
    this.reader = new MultipartByteReader(
      toReadableStream(input.body),
      options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE,
      input.signal,
    );
    this.abortListener = input.signal
      ? () => {
          const reason = input.signal?.reason
            ?? new DOMException('The request was aborted.', 'AbortError');
          void this.cancel(reason);
        }
      : undefined;

    if (input.signal?.aborted) {
      this.abortListener?.();
    } else if (this.abortListener) {
      input.signal?.addEventListener('abort', this.abortListener, { once: true });
    }
  }

  async cancel(reason?: unknown): Promise<void> {
    this.removeAbortListener();
    const cancellationError = reason instanceof Error
      ? reason
      : new DOMException(
          reason === undefined ? 'Multipart parsing was cancelled.' : String(reason),
          'AbortError',
        );
    this.rejectActiveFileDone?.(cancellationError);
    this.rejectActiveFileDone = undefined;
    await this.reader.cancel(reason);
  }

  createPartStream(): ReadableStream<FrameworkMultipartPart> {
    return new ReadableStream<FrameworkMultipartPart>({
      cancel: async (reason) => this.cancel(reason),
      pull: async (controller) => {
        try {
          const part = await this.nextPart();

          if (part) {
            controller.enqueue(part);
          } else {
            controller.close();
          }
        } catch (error: unknown) {
          await this.cancel(error);
          controller.error(error);
        }
      },
    }, { highWaterMark: 0 });
  }

  private async nextPart(): Promise<FrameworkMultipartPart | undefined> {
    await this.activeFileDone;
    this.activeFileDone = undefined;

    if (this.finalBoundary) {
      return undefined;
    }

    if (!this.initialized) {
      await this.reader.skipPreamble(this.initialBoundary, this.bodyBoundary);
      this.initialized = true;
      await this.finishBoundary();

      if (this.finalBoundary) {
        return undefined;
      }
    }

    const headers = parseHeaders(
      await this.reader.readUntil(HEADER_END, this.maxHeaderSize),
      this.maxHeaders,
    );
    const disposition = parseContentDisposition(headers['content-disposition']);

    if (disposition.filename === undefined) {
      this.fieldCount += 1;

      if (this.fieldCount > this.maxFields) {
        throw new PayloadTooLargeException(
          `Exceeded maximum field count of ${String(this.maxFields)}.`,
        );
      }

      const value = await this.readFieldValue();
      return {
        fieldname: disposition.name,
        headers,
        kind: 'field',
        value,
      };
    }

    this.fileCount += 1;

    if (this.fileCount > this.maxFiles) {
      throw new PayloadTooLargeException(
        `Exceeded maximum file count of ${String(this.maxFiles)}.`,
      );
    }

    return this.createFilePart(headers, disposition.name, disposition.filename);
  }

  private createFilePart(
    headers: Readonly<Record<string, string>>,
    fieldname: string,
    originalname: string,
  ): FrameworkMultipartFilePart {
    let resolveDone!: () => void;
    let rejectDone!: (error: unknown) => void;
    let size = 0;
    this.activeFileDone = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    this.rejectActiveFileDone = rejectDone;
    void this.activeFileDone.catch(() => {});

    const stream = new ReadableStream<Uint8Array>({
      cancel: async () => {
        try {
          await this.drainFilePart(fieldname, size);
          this.rejectActiveFileDone = undefined;
          resolveDone();
        } catch (error: unknown) {
          await this.cancel(error);
          rejectDone(error);
          throw error;
        }
      },
      pull: async (controller) => {
        try {
          const chunk = await this.reader.readBodyChunk(this.bodyBoundary);
          size += chunk.bytes.byteLength;

          if (size > this.maxFileSize) {
            throw new PayloadTooLargeException(
              `File "${fieldname}" exceeds the maximum size of ${String(this.maxFileSize)} bytes.`,
            );
          }

          if (chunk.bytes.byteLength > 0) {
            controller.enqueue(chunk.bytes);
          }

          if (chunk.boundary) {
            await this.finishBoundary();
            controller.close();
            this.rejectActiveFileDone = undefined;
            resolveDone();
          }
        } catch (error: unknown) {
          await this.cancel(error);
          controller.error(error);
          rejectDone(error);
        }
      },
    }, { highWaterMark: 0 });

    return {
      fieldname,
      headers,
      kind: 'file',
      mimetype: headers['content-type'] ?? 'application/octet-stream',
      originalname,
      stream,
    };
  }

  private async readFieldValue(): Promise<string> {
    const chunks: Uint8Array[] = [];

    for (;;) {
      const chunk = await this.reader.readBodyChunk(this.bodyBoundary);
      chunks.push(chunk.bytes);

      if (chunk.boundary) {
        await this.finishBoundary();
        return DECODER.decode(concatChunks(chunks));
      }
    }
  }

  private async drainFilePart(fieldname: string, initialSize: number): Promise<void> {
    let size = initialSize;

    for (;;) {
      const chunk = await this.reader.readBodyChunk(this.bodyBoundary);
      size += chunk.bytes.byteLength;

      if (size > this.maxFileSize) {
        throw new PayloadTooLargeException(
          `File "${fieldname}" exceeds the maximum size of ${String(this.maxFileSize)} bytes.`,
        );
      }

      if (chunk.boundary) {
        await this.finishBoundary();
        return;
      }
    }
  }

  private async finishBoundary(): Promise<void> {
    const suffix = await this.reader.readBytes(2);

    if (bytesEqual(suffix, CRLF)) {
      return;
    }

    if (suffix[0] === 45 && suffix[1] === 45) {
      this.finalBoundary = true;
      await this.reader.complete();
      this.removeAbortListener();
      return;
    }

    throw new BadRequestException('Multipart boundary has an invalid terminator.');
  }

  private removeAbortListener(): void {
    if (this.abortListener) {
      this.signal?.removeEventListener('abort', this.abortListener);
    }
  }
}
