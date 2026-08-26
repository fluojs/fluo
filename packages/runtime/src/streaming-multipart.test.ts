import { PayloadTooLargeException } from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import { createStreamingMultipart } from './streaming-multipart.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const BOUNDARY = 'fluo-boundary';

function createMultipartChunks(parts: readonly string[]): Uint8Array[] {
  return parts.map((part) => ENCODER.encode(part));
}

function createTrackedBody(chunks: readonly Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[index];
    index += 1;

    if (chunk) {
      controller.enqueue(chunk);
      return;
    }

    controller.close();
  });

  return {
    body: new ReadableStream<Uint8Array>({ cancel, pull }, { highWaterMark: 0 }),
    cancel,
    pull,
  };
}

function createSourceReleaseSignal(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function waitForSourceRelease(sourceReleased: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      sourceReleased,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Multipart source reader was not released.')), 1_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  for (;;) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
  }

  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const value = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return DECODER.decode(value);
}

describe('createStreamingMultipart', () => {
  it('emits typed field and file parts without buffering the complete file', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n`,
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      'first-',
      'second',
      `\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        fieldname: 'name',
        headers: {
          'content-disposition': 'form-data; name="name"',
        },
        kind: 'field',
        value: 'Ada',
      },
    });

    const fileResult = await reader.read();
    expect(fileResult.done).toBe(false);
    expect(fileResult.value).toMatchObject({
      fieldname: 'payload',
      headers: {
        'content-disposition': 'form-data; name="payload"; filename="payload.txt"',
        'content-type': 'text/plain',
      },
      kind: 'file',
      mimetype: 'text/plain',
      originalname: 'payload.txt',
    });
    expect(tracked.pull).toHaveBeenCalledTimes(2);

    if (fileResult.done || fileResult.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(fileResult.value.stream)).resolves.toBe('first-second');
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each([
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
        `before\r\n--${BOUNDARY}Xafter\r\n--${BOUNDARY}--not-a-delimiter`,
        `\r\n--${BOUNDARY}--\r\n`,
      ],
    },
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
        `before\r\n--${BOUNDARY}Xafter\r\n--${BOUNDARY}--`,
        `not-a-delimiter\r\n--${BOUNDARY}--\r`,
        '\n',
      ],
    },
  ])('preserves boundary-like file bytes unless the full delimiter grammar matches', async ({ chunks }) => {
    const tracked = createTrackedBody(createMultipartChunks(chunks));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();
    const part = await reader.read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(part.value.stream)).resolves.toBe(
      `before\r\n--${BOUNDARY}Xafter\r\n--${BOUNDARY}--not-a-delimiter`,
    );
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('fails clearly when the body is consumed more than once', () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });

    multipart.consume();

    expect(() => multipart.consume()).toThrow('Streaming multipart body can only be consumed once.');
  });

  it.each([
    ['space-padded regular and tab-padded closing delimiters', ' ', '\t'],
    ['tab-padded regular and space-padded closing delimiters', '\t', ' '],
  ])('accepts %s split across source chunks', async (_name, regularPadding, closingPadding) => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}`,
      regularPadding,
      '\r',
      '\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n--',
      BOUNDARY,
      '--',
      closingPadding,
      '\r',
      '\n',
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        fieldname: 'name',
        headers: {
          'content-disposition': 'form-data; name="name"',
        },
        kind: 'field',
        value: 'Ada',
      },
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('preserves a delimiter with an invalid transport-padding byte as field data', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\n`,
      `Ada\r\n--${BOUNDARY}\v\r\nstill-data\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        fieldname: 'name',
        headers: {
          'content-disposition': 'form-data; name="name"',
        },
        kind: 'field',
        value: `Ada\r\n--${BOUNDARY}\v\r\nstill-data`,
      },
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each([
    ['space', ' '],
    ['tab', '\t'],
    ['mixed LWSP', ' \t\t '],
  ])('accepts a %s-padded closing delimiter at EOF across source chunks', async (_name, padding) => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n--${BOUNDARY}--`,
      ...Array.from(padding),
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: {
        fieldname: 'name',
        kind: 'field',
        value: 'Ada',
      },
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('enforces the active file limit after invalidating long transport padding', async () => {
    const padding = ' \t'.repeat(65_536);
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      `start\r\n--${BOUNDARY}`,
      ...Array.from(padding),
      'X\r\nstill-data\r\n',
      `--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxFileSize: 16 },
    });
    const reader = multipart.consume().getReader();
    const part = await reader.read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(part.value.stream)).rejects.toThrow(
      'File "payload" exceeds the maximum size of 16 bytes.',
    );
    expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['a regular boundary', `\r\n--${BOUNDARY} \t \r\nContent-Disposition: form-data; name="next"\r\n\r\nnext\r\n--${BOUNDARY}--\r\n`],
    ['a closing boundary at EOF', `\r\n--${BOUNDARY}-- \t `],
  ])('does not charge legal transport padding against an exact file limit before %s', async (_name, suffix) => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      '1234567890123456',
      ...Array.from(suffix),
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxFileSize: 16 },
    });
    const reader = multipart.consume().getReader();
    const part = await reader.read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(part.value.stream)).resolves.toBe('1234567890123456');

    if (_name === 'a regular boundary') {
      await expect(reader.read()).resolves.toMatchObject({
        done: false,
        value: {
          fieldname: 'next',
          kind: 'field',
          value: 'next',
        },
      });
    }

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('rejects an exact-limit file when boundary-like padding has an invalid terminator', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      `1234567890123456\r\n--${BOUNDARY} \tX\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxFileSize: 16 },
    });
    const reader = multipart.consume().getReader();
    const part = await reader.read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(part.value.stream)).rejects.toThrow(
      'File "payload" exceeds the maximum size of 16 bytes.',
    );
    expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it('preserves all long invalid transport-padding bytes when the file limit allows them', async () => {
    const padding = ' \t'.repeat(2_048);
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\n`,
      `Ada\r\n--${BOUNDARY}`,
      ...Array.from(padding),
      `X\r\nstill-data\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const reader = multipart.consume().getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        fieldname: 'name',
        headers: {
          'content-disposition': 'form-data; name="name"',
        },
        kind: 'field',
        value: `Ada\r\n--${BOUNDARY}${padding}X\r\nstill-data`,
      },
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('accepts an empty multipart body terminated by the initial boundary', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });

    await expect(multipart.consume().getReader().read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it.each([
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="first"\r\n\r\none\r\n`,
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="second"\r\n\r\ntwo\r\n--${BOUNDARY}--\r\n`,
      ],
      expected: 'Exceeded maximum field count of 1.',
      options: { maxFields: 1 },
    },
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="first"; filename="1.txt"\r\n\r\none\r\n`,
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="second"; filename="2.txt"\r\n\r\ntwo\r\n--${BOUNDARY}--\r\n`,
      ],
      expected: 'Exceeded maximum file count of 1.',
      options: { maxFiles: 1 },
    },
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="field-with-a-long-header"\r\n\r\nvalue\r\n--${BOUNDARY}--\r\n`,
      ],
      expected: 'Multipart part headers exceed the maximum size of 32 bytes.',
      options: { maxHeaderSize: 32 },
    },
    {
      chunks: [
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="field"\r\nX-First: one\r\nX-Second: two\r\n\r\nvalue\r\n--${BOUNDARY}--\r\n`,
      ],
      expected: 'Multipart part exceeds the maximum header count of 2.',
      options: { maxHeaders: 2 },
    },
  ])('enforces count and header limits', async ({ chunks, expected, options }) => {
    const tracked = createTrackedBody(createMultipartChunks(chunks));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options,
    });
    const reader = multipart.consume().getReader();

    await expect((async () => {
      for (;;) {
        const result = await reader.read();

        if (result.done) {
          return;
        }

        if (result.value.kind === 'file') {
          await readText(result.value.stream);
        }
      }
    })()).rejects.toThrow(expected);
  });

  it('terminates an oversized file and cancels parser resources', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      'hello',
      `\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxFileSize: 4 },
    });
    const part = await multipart.consume().getReader().read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(readText(part.value.stream)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it('enforces the file limit while draining a cancelled file part', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      'hello',
      `\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxFileSize: 4 },
    });
    const part = await multipart.consume().getReader().read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    await expect(part.value.stream.cancel()).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it('terminates total-size overflow and malformed bodies with deterministic cleanup', async () => {
    const oversized = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n--${BOUNDARY}--\r\n`,
    ]));
    const oversizedMultipart = createStreamingMultipart({
      body: oversized.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      options: { maxTotalSize: 16 },
    });

    await expect(oversizedMultipart.consume().getReader().read()).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(oversized.cancel).toHaveBeenCalledOnce();

    const malformed = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda`,
    ]));
    const malformedMultipart = createStreamingMultipart({
      body: malformed.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });

    await expect(malformedMultipart.consume().getReader().read()).rejects.toThrow(
      'Multipart body ended before the closing boundary.',
    );
    expect(malformed.pull).toHaveBeenCalledTimes(2);
    expect(malformed.cancel).not.toHaveBeenCalled();
  });

  it('propagates request aborts to the active file stream and parser source', async () => {
    const abortController = new AbortController();
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      'hello',
      `\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      signal: abortController.signal,
    });
    const part = await multipart.consume().getReader().read();

    if (part.done || part.value.kind !== 'file') {
      throw new Error('Expected a streaming multipart file part.');
    }

    abortController.abort(new Error('client disconnected'));

    await expect(part.value.stream.getReader().read()).rejects.toThrow('client disconnected');
    expect(tracked.cancel).toHaveBeenCalledOnce();
  });

  it.each(['dispatch cleanup', 'total limit', 'file limit', 'request abort'] as const)(
    'does not leave an unhandled native FormData producer rejection after %s',
    async (scenario) => {
      const sourceReleased = createSourceReleaseSignal();

      await (async () => {
        const abortController = new AbortController();
        const form = new FormData();
        form.set('title', 'streamed');
        form.set('payload', new Blob([new Uint8Array(1024 * 1024)]), 'payload.bin');
        const request = new Request('https://runtime.test/uploads', {
          body: form,
          method: 'POST',
          signal: abortController.signal,
        });
        const multipart = createStreamingMultipart({
          body: request.body!,
          contentType: request.headers.get('content-type')!,
          options: scenario === 'total limit' ? { maxTotalSize: 10 }
            : scenario === 'file limit' ? { maxFileSize: 10 }
            : undefined,
          signal: abortController.signal,
          cancelSource: false,
          onSourceReleased: sourceReleased.release,
        });
        const reader = multipart.consume().getReader();

        if (scenario === 'dispatch cleanup') {
          await reader.cancel('Request dispatch completed.');
          return;
        }

        if (scenario === 'total limit') {
          await expect(reader.read()).rejects.toBeInstanceOf(PayloadTooLargeException);
          return;
        }

        await expect(reader.read()).resolves.toMatchObject({
          done: false,
          value: { kind: 'field' },
        });
        const file = await reader.read();

        if (file.done || file.value.kind !== 'file') {
          throw new Error('Expected a streaming multipart file part.');
        }

        if (scenario === 'file limit') {
          await expect(readText(file.value.stream)).rejects.toBeInstanceOf(PayloadTooLargeException);
          return;
        }

        abortController.abort(new Error('client disconnected'));
        await expect(file.value.stream.getReader().read()).rejects.toThrow('client disconnected');
      })();

      await waitForSourceRelease(sourceReleased.promise);
    },
  );

  it('propagates the exact cancellation reason to an async iterable once', async () => {
    const reason = new Error('handler completed');
    const iteratorReturn = vi.fn(async (value?: unknown): Promise<IteratorResult<Uint8Array, unknown>> => ({
      done: true,
      value,
    }));
    const body: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return: iteratorReturn,
        };
      },
    };
    const multipart = createStreamingMultipart({
      body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });

    await Promise.all([
      multipart.cancel(reason),
      multipart.cancel(new Error('later cancellation')),
    ]);

    expect(iteratorReturn).toHaveBeenCalledOnce();
    expect(iteratorReturn).toHaveBeenCalledWith(reason);
  });

  it('cancels parser work when the multipart part stream is cancelled', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      'hello',
      `\r\n--${BOUNDARY}--\r\n`,
    ]));
    const multipart = createStreamingMultipart({
      body: tracked.body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
    });
    const parts = multipart.consume();

    await parts.cancel('handler completed');

    expect(tracked.cancel).toHaveBeenCalledWith('handler completed');
    expect(tracked.body.locked).toBe(false);
  });

  it.each(['public cancellation', 'request abort'] as const)(
    'settles a pending next-part read after %s with an unconsumed file',
    async (cancellation) => {
      const abortController = new AbortController();
      const tracked = createTrackedBody(createMultipartChunks([
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
        'hello',
        `\r\n--${BOUNDARY}--\r\n`,
      ]));
      const multipart = createStreamingMultipart({
        body: tracked.body,
        contentType: `multipart/form-data; boundary=${BOUNDARY}`,
        signal: abortController.signal,
      });
      const reader = multipart.consume().getReader();
      const part = await reader.read();

      if (part.done || part.value.kind !== 'file') {
        throw new Error('Expected a streaming multipart file part.');
      }

      const nextPart = reader.read();
      const reason = new Error(`${cancellation} completed`);

      if (cancellation === 'public cancellation') {
        await multipart.cancel(reason);
      } else {
        abortController.abort(reason);
      }

      await expect(nextPart).rejects.toBe(reason);
      expect(tracked.cancel).toHaveBeenCalledOnce();
      expect(tracked.body.locked).toBe(false);
    },
  );

  it('joins concurrent abort, iterator return, and dispatch cleanup on one source cancellation', async () => {
    let resolveCancelStarted!: (reason: unknown) => void;
    let resolveCleanup!: () => void;
    const cancelStarted = new Promise<unknown>((resolve) => {
      resolveCancelStarted = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const cancel = vi.fn(async (reason: unknown) => {
      resolveCancelStarted(reason);
      await cleanup;
    });
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(ENCODER.encode(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
        ));
      },
    }, { highWaterMark: 0 });
    const abortController = new AbortController();
    const multipart = createStreamingMultipart({
      body,
      contentType: `multipart/form-data; boundary=${BOUNDARY}`,
      signal: abortController.signal,
    });
    const parts = multipart.consume();
    const iteratorReturn = parts.cancel('iterator returned');

    await expect(cancelStarted).resolves.toBe('iterator returned');
    abortController.abort(new Error('request aborted'));
    const dispatchCleanup = multipart.cancel('dispatch finished');
    let resolveEarlyCheck!: () => void;
    const earlyCheck = new Promise<void>((resolve) => {
      resolveEarlyCheck = resolve;
    });
    const cleanupState = Promise.race([
      dispatchCleanup.then(() => 'settled'),
      earlyCheck.then(() => 'pending'),
    ]);

    resolveEarlyCheck();
    await expect(cleanupState).resolves.toBe('pending');
    expect(cancel).toHaveBeenCalledOnce();

    resolveCleanup();
    await expect(Promise.all([iteratorReturn, dispatchCleanup])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(body.locked).toBe(false);
  });
});
