import { describe, expect, it, vi } from 'vitest';

import { PayloadTooLargeException } from '@fluojs/http';

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

  it('preserves boundary-like file bytes without a legal delimiter suffix', async () => {
    const tracked = createTrackedBody(createMultipartChunks([
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="payload"; filename="payload.txt"\r\n\r\n`,
      `before\r\n--${BOUNDARY}Xafter\r\n--fluo-`,
      `boundary-after\r\n--${BOUNDARY}--\r\n`,
    ]));
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
      `before\r\n--${BOUNDARY}Xafter\r\n--${BOUNDARY}-after`,
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
});
