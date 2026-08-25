import { describe, expect, it, vi } from 'vitest';

import { MultipartByteReader } from './multipart-byte-reader.js';

describe('MultipartByteReader', () => {
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
