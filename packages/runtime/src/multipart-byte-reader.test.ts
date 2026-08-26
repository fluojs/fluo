import { describe, expect, it, vi } from 'vitest';

import { MultipartByteReader } from './multipart-byte-reader.js';

describe('MultipartByteReader', () => {
  it('discards a chunked multipart preamble while scanning for the first boundary', async () => {
    const boundary = 'fluo-preamble';
    const initialBoundary = new TextEncoder().encode(`--${boundary}`);
    const bodyBoundary = new TextEncoder().encode(`\r\n--${boundary}`);
    const chunks = [
      ...Array.from({ length: 128 }, () => new Uint8Array(1024)),
      new TextEncoder().encode(`\r\n--${boundary}\r\n`),
    ];
    const retainedSizes: number[] = [];
    let index = 0;
    let reader: MultipartByteReader | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!reader) {
          throw new Error('Expected the multipart byte reader before source pull.');
        }

        retainedSizes.push((reader as unknown as { buffer: Uint8Array }).buffer.byteLength);
        const chunk = chunks[index];
        index += 1;

        if (chunk) {
          controller.enqueue(chunk);
          return;
        }

        controller.close();
      },
    }, { highWaterMark: 0 });
    reader = new MultipartByteReader(body, 256 * 1024);

    await reader.skipPreamble(initialBoundary, bodyBoundary);

    expect(Math.max(...retainedSizes)).toBeLessThanOrEqual(bodyBoundary.byteLength - 1);
    await expect(reader.readBytes(2)).resolves.toEqual(new Uint8Array([13, 10]));
    await reader.cancel();
    expect(body.locked).toBe(false);
  });

  it('scans long split transport padding with linear copies', async () => {
    const boundary = 'fluo-transport-padding';
    const initialBoundary = new TextEncoder().encode(`--${boundary}`);
    const bodyBoundary = new TextEncoder().encode(`\r\n--${boundary}`);
    const padding = Array.from(
      { length: 4_096 },
      (_, index) => new Uint8Array([index % 2 === 0 ? 32 : 9]),
    );
    const chunks = [initialBoundary, ...padding, new Uint8Array([13]), new Uint8Array([10])];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;

        if (chunk) {
          controller.enqueue(chunk);
          return;
        }

        controller.close();
      },
    }, { highWaterMark: 0 });
    const reader = new MultipartByteReader(body, 8 * 1024);
    const nativeSet = Uint8Array.prototype.set;
    let copiedBytes = 0;
    const set = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function (
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ): void {
      copiedBytes += source.length;
      nativeSet.call(this, source, offset);
    });

    try {
      await reader.skipPreamble(initialBoundary, bodyBoundary);
      await expect(reader.consumeBoundarySuffix()).resolves.toBe(false);
      expect(copiedBytes).toBeLessThan(padding.length * 4);
    } finally {
      set.mockRestore();
      await reader.cancel();
    }

    expect(body.locked).toBe(false);
  });

  it('pages one-byte alternating invalid transport padding without copying or dropping payload bytes', async () => {
    const boundary = 'fluo-invalid-transport-padding';
    const delimiter = `\r\n--${boundary}`;
    const bodyBoundary = new TextEncoder().encode(delimiter);
    const paddingLength = 1_000_000;
    const padding = ' \t'.repeat(paddingLength / 2);
    const space = new Uint8Array([32]);
    const tab = new Uint8Array([9]);
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === 0) {
          controller.enqueue(new TextEncoder().encode(`payload${delimiter}`));
        } else if (index <= paddingLength) {
          controller.enqueue(index % 2 === 1 ? space : tab);
        } else if (index === paddingLength + 1) {
          controller.enqueue(new Uint8Array([88]));
        } else {
          controller.close();
        }

        index += 1;
      },
    }, { highWaterMark: 0 });
    const reader = new MultipartByteReader(body, paddingLength * 2);
    const nativeSet = Uint8Array.prototype.set;
    let copiedBytes = 0;
    const set = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function (
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ): void {
      copiedBytes += source.length;
      nativeSet.call(this, source, offset);
    });
    const decodedChunks: string[] = [];

    try {
      const first = await reader.readBodyChunk(bodyBoundary);
      decodedChunks.push(new TextDecoder().decode(first.bytes));
      expect((reader as unknown as { literalSegments: Uint8Array[] }).literalSegments.length).toBeLessThan(130);

      for (;;) {
        try {
          const chunk = await reader.readBodyChunk(bodyBoundary);
          decodedChunks.push(new TextDecoder().decode(chunk.bytes));
        } catch (error) {
          expect(error).toMatchObject({
            message: 'Multipart body ended before the closing boundary.',
          });
          break;
        }
      }

      expect(decodedChunks.join('')).toBe(`payload${delimiter}${padding}X`);
      expect(copiedBytes).toBeLessThan(paddingLength * 4);
    } finally {
      set.mockRestore();
      await reader.cancel();
    }

    expect(body.locked).toBe(false);
  });

  it('keeps abort cancellation active while draining the multipart epilogue', async () => {
    let markPullStarted!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull() {
        markPullStarted();
        return new Promise<void>(() => {});
      },
    }, { highWaterMark: 0 });
    const abortController = new AbortController();
    const reader = new MultipartByteReader(body, 1024, abortController.signal);
    const completion = reader.complete();

    await pullStarted;
    const reason = new Error('client disconnected during epilogue drain');
    abortController.abort(reason);

    await expect(completion).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('discards epilogue chunks instead of retaining the complete epilogue', async () => {
    const epilogueChunks = Array.from(
      { length: 128 },
      () => new Uint8Array(1024),
    );
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = epilogueChunks[index];
        index += 1;

        if (chunk) {
          controller.enqueue(chunk);
          return;
        }

        controller.close();
      },
    }, { highWaterMark: 0 });
    const reader = new MultipartByteReader(body, 256 * 1024);

    await reader.complete();

    expect((reader as unknown as { buffer: Uint8Array }).buffer.byteLength).toBe(0);
    expect(body.locked).toBe(false);
  });
});
