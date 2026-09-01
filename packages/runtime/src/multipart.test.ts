import { describe, expect, it, vi } from 'vitest';

import { PayloadTooLargeException } from '@fluojs/http';

import {
  MultipartBodyConsumedError,
  parseMultipart,
  parseMultipartStream,
} from './multipart.js';

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function createMultipartBody(
  boundary: string,
  parts: Array<{ headers: string[]; value: string }>,
): string {
  return parts
    .map((part) => `--${boundary}\r\n${part.headers.join('\r\n')}\r\n\r\n${part.value}\r\n`)
    .join('')
    .concat(`--${boundary}--\r\n`);
}

function createChunkedMultipartRequest(
  boundary: string,
  chunks: readonly string[],
  options: {
    holdAfterChunks?: boolean;
    onCancel?: (reason: unknown) => void;
    signal?: AbortSignal;
  } = {},
) {
  let index = 0;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel(reason) {
      options.onCancel?.(reason);
    },
    pull(controller) {
      pulls += 1;
      const chunk = chunks[index++];

      if (chunk === undefined) {
        if (options.holdAfterChunks) {
          return;
        }

        controller.close();
        return;
      }

      controller.enqueue(TEXT_ENCODER.encode(chunk));
    },
  });

  return {
    body,
    get pulls() {
      return pulls;
    },
    request: {
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
      signal: options.signal,
      url: 'http://localhost/uploads',
    },
  };
}

describe('parseMultipart', () => {
  it('parses Web multipart fields and files without Node Buffer conversion APIs', async () => {
    // Given
    const form = new FormData();
    form.append('name', '홍길동');
    form.append('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');
    const request = new Request('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });
    vi.spyOn(Buffer, 'byteLength').mockImplementation(() => {
      throw new TypeError('Web multipart parsing must not call Buffer.byteLength().');
    });

    try {
      // When
      const result = await parseMultipart(request);

      // Then
      expect(result.fields).toEqual({ name: '홍길동' });
      expect(result.files).toEqual([
        {
          buffer: new TextEncoder().encode('hello'),
          fieldname: 'payload',
          mimetype: 'text/plain',
          originalname: 'payload.txt',
          size: 5,
        },
      ]);
      expect(Buffer.isBuffer(result.files[0]?.buffer)).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('parses fields and uploaded files from a web Request', async () => {
    const form = new FormData();
    form.append('name', 'Ada');
    form.append('tag', 'runtime');
    form.append('tag', 'portable');
    form.append('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

    const request = new Request('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });

    await expect(parseMultipart(request)).resolves.toEqual({
      fields: {
        name: 'Ada',
        tag: ['runtime', 'portable'],
      },
      files: [
        {
          buffer: new TextEncoder().encode('hello'),
          fieldname: 'payload',
          mimetype: 'text/plain',
          originalname: 'payload.txt',
          size: 5,
        },
      ],
    });
  });

  it('parses multipart input from request-like compatibility wrappers', async () => {
    const form = new FormData();
    form.append('name', 'Ada');
    form.append('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

    const request = new Request('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });

    await expect(
      parseMultipart({
        body: request.body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
      }),
    ).resolves.toEqual({
      fields: { name: 'Ada' },
      files: [
        {
          buffer: new TextEncoder().encode('hello'),
          fieldname: 'payload',
          mimetype: 'text/plain',
          originalname: 'payload.txt',
          size: 5,
        },
      ],
    });
  });

  it('rejects files larger than the configured limit', async () => {
    const form = new FormData();
    form.append('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

    const request = new Request('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });

    const result = parseMultipart(request, { maxFileSize: 4 });

    await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(result).rejects.toThrow(
      'File "payload" exceeds the maximum size of 4 bytes.',
    );
  });

  it('rejects more files than the configured limit', async () => {
    const boundary = 'fluo-file-count';
    const request = new Request('http://localhost/uploads', {
      body: createMultipartBody(boundary, [
        {
          headers: [
            'content-disposition: form-data; name="first"; filename="first.txt"',
            'content-type: text/plain',
          ],
          value: 'a',
        },
        {
          headers: [
            'content-disposition: form-data; name="second"; filename="second.txt"',
            'content-type: text/plain',
          ],
          value: 'b',
        },
      ]),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    const result = parseMultipart(request, { maxFiles: 1 });

    await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(result).rejects.toThrow('Exceeded maximum file count of 1.');
  });

  it('rejects multipart payloads that exceed the configured total size limit', async () => {
    const boundary = 'fluo-total-size';
    const request = new Request('http://localhost/uploads', {
      body: createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="name"'],
          value: 'Ada Lovelace',
        },
        {
          headers: [
            'content-disposition: form-data; name="payload"; filename="payload.txt"',
            'content-type: text/plain',
          ],
          value: 'hello',
        },
      ]),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    const result = parseMultipart(request, { maxTotalSize: 10 });

    await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(result).rejects.toThrow('Multipart body exceeds the maximum size of 10 bytes.');
  });

  it('rejects an oversized Web stream without waiting for another chunk', async () => {
    let cancellationReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReason = reason;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(11));
      },
    });

    await expect(
      parseMultipart(
        {
          body,
          headers: {
            'content-type':
              'multipart/form-data; boundary=fluo-never-drain',
          },
          method: 'POST',
          url: 'http://localhost/uploads',
        },
        { maxTotalSize: 10 },
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(cancellationReason).toBeInstanceOf(PayloadTooLargeException);
  });

  it.each([
    {
      body: createMultipartBody('fluo-buffered-limits', [
        {
          headers: ['content-disposition: form-data; name="title"'],
          value: 'hello',
        },
      ]),
      message: 'Field exceeds the maximum size of 4 bytes.',
      name: 'field size',
      options: { maxFieldSize: 4 },
    },
    {
      body: createMultipartBody('fluo-buffered-limits', [
        {
          headers: ['content-disposition: form-data; name="first"'],
          value: 'one',
        },
        {
          headers: ['content-disposition: form-data; name="second"'],
          value: 'two',
        },
      ]),
      message: 'Exceeded maximum field count of 1.',
      name: 'field count',
      options: { maxFields: 1 },
    },
    {
      body: createMultipartBody('fluo-buffered-limits', [
        {
          headers: ['content-disposition: form-data; name="title"'],
          value: 'value',
        },
      ]),
      message: 'Multipart part headers exceed the maximum size of 10 bytes.',
      name: 'header size',
      options: { maxHeaderSize: 10 },
    },
  ])('enforces configured buffered $name limits and releases the source', async ({ body, message, options }) => {
    // Given
    const source = createChunkedMultipartRequest('fluo-buffered-limits', [body]);

    // When
    const result = parseMultipart(source.request, options);

    // Then
    await expect(result).rejects.toThrow(message);
    expect(source.body.locked).toBe(false);
  });

  it('keeps legacy buffered field and header acceptance unbounded unless configured', async () => {
    const boundary = 'fluo-buffered-defaults';
    const oversizedField = 'x'.repeat(1024 * 1024 + 1);
    const oversizedHeader = `x-fluo-extension: ${'y'.repeat(8 * 1024 + 1)}`;
    const request = new Request('http://localhost/uploads', {
      body: createMultipartBody(boundary, [
        {
          headers: [
            'content-disposition: form-data; name="title"',
            oversizedHeader,
          ],
          value: oversizedField,
        },
      ]),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    await expect(parseMultipart(request)).resolves.toMatchObject({
      fields: { title: oversizedField },
    });
  });

  it('keeps more than one hundred small fields within the total-size limit', async () => {
    // Given
    const boundary = 'fluo-buffered-field-count';
    const request = new Request('http://localhost/uploads', {
      body: createMultipartBody(
        boundary,
        Array.from({ length: 101 }, (_, index) => ({
          headers: [`content-disposition: form-data; name="field-${String(index)}"`],
          value: 'ok',
        })),
      ),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    // When
    const result = parseMultipart(request);

    // Then
    await expect(result).resolves.toMatchObject({
      fields: {
        'field-0': 'ok',
        'field-100': 'ok',
      },
    });
  });
});

describe('parseMultipartStream', () => {
  it('yields typed fields and streams each file without reading the complete payload', async () => {
    const boundary = 'fluo-streaming-boundary';
    const fileHeader = `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\ncontent-type: text/plain\r\n\r\n`;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let completeBodyArrived = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(TEXT_ENCODER.encode(fileHeader + 'x'.repeat(128)));
      },
    });
    const parts = parseMultipartStream({
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
      url: 'http://localhost/uploads',
    });

    const first = await parts.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      contentType: 'text/plain',
      filename: 'payload.txt',
      headers: {
        'content-disposition': 'form-data; name="upload"; filename="payload.txt"',
        'content-type': 'text/plain',
      },
      kind: 'file',
      name: 'upload',
    });
    expect(completeBodyArrived).toBe(false);

    const file = first.value;

    if (file.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    const reader = file.stream.getReader();
    const chunks: Uint8Array[] = [];
    const initialChunk = await reader.read();

    expect(initialChunk.done).toBe(false);
    expect(completeBodyArrived).toBe(false);

    if (initialChunk.value) {
      chunks.push(initialChunk.value);
    }

    completeBodyArrived = true;
    bodyController?.enqueue(TEXT_ENCODER.encode(`tail\r\n--${boundary}--\r\n`));
    bodyController?.close();

    while (true) {
      const next = await reader.read();

      if (next.done) {
        break;
      }

      chunks.push(next.value);
    }

    expect(TEXT_DECODER.decode(concat(chunks))).toBe('x'.repeat(128) + 'tail');
    await expect(parts.next()).resolves.toMatchObject({ done: true });
  });

  it('yields typed field parts before files', async () => {
    const boundary = 'fluo-typed-parts';
    const source = createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="title"'],
          value: 'Portable upload',
        },
        {
          headers: [
            'content-disposition: form-data; name="upload"; filename="note.txt"',
            'content-type: text/plain',
          ],
          value: 'hello',
        },
      ]),
    ]);
    const parts = parseMultipartStream(source.request);

    await expect(parts.next()).resolves.toEqual({
      done: false,
      value: {
        headers: {
          'content-disposition': 'form-data; name="title"',
        },
        kind: 'field',
        name: 'title',
        value: 'Portable upload',
      },
    });

    const second = await parts.next();

    expect(second.value).toMatchObject({
      contentType: 'text/plain',
      filename: 'note.txt',
      kind: 'file',
      name: 'upload',
    });
  });

  it('enforces field, file, file-size, total-size, and header limits', async () => {
    const boundary = 'fluo-stream-limits';
    const twoFields = createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="first"'],
          value: 'one',
        },
        {
          headers: ['content-disposition: form-data; name="second"'],
          value: 'two',
        },
      ]),
    ]);
    const oversizedHeaders = createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="long-header"'],
          value: 'value',
        },
      ]),
    ]);
    const file = createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: [
            'content-disposition: form-data; name="upload"; filename="payload.txt"',
            'content-type: text/plain',
          ],
          value: 'hello',
        },
      ]),
    ]);

    const fields = parseMultipartStream(twoFields.request, { maxFields: 1 });
    await expect(fields.next()).resolves.toMatchObject({ done: false });
    await expect(fields.next()).rejects.toThrow('Exceeded maximum field count of 1.');

    await expect(
      parseMultipartStream(oversizedHeaders.request, { maxHeaderSize: 10 }).next(),
    ).rejects.toThrow('Multipart part headers exceed the maximum size of 10 bytes.');

    const files = parseMultipartStream(file.request, { maxFileSize: 4 });
    const first = await files.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    await expect(new Response(first.value.stream).text()).rejects.toThrow(
      'File "upload" exceeds the maximum size of 4 bytes.',
    );

    await expect(
      parseMultipartStream(
        createChunkedMultipartRequest(boundary, [createMultipartBody(boundary, [])]).request,
        { maxTotalSize: 1 },
      ).next(),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('enforces maxFiles while streaming without buffering earlier files', async () => {
    // Given
    const boundary = 'fluo-streaming-file-count';
    const parts = parseMultipartStream(createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="first"; filename="first.txt"'],
          value: 'first',
        },
        {
          headers: ['content-disposition: form-data; name="second"; filename="second.txt"'],
          value: 'second',
        },
      ]),
    ]).request, { maxFiles: 1 });
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected the first multipart file.');
    }

    // When
    await new Response(first.value.stream).arrayBuffer();

    // Then
    await expect(parts.next()).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects a pre-aborted streaming request and releases its body lock', async () => {
    // Given
    const boundary = 'fluo-pre-aborted';
    const controller = new AbortController();
    const abortReason = new Error('client disconnected before parsing');
    controller.abort(abortReason);
    const body = new ReadableStream<Uint8Array>();

    // When
    const parts = parseMultipartStream({
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      signal: controller.signal,
      url: 'http://localhost/uploads',
    });

    // Then
    await expect(parts.next()).rejects.toBe(abortReason);
    expect(body.locked).toBe(false);
  });

  it('does not pull an active file source again until its stream is read', async () => {
    // Given
    const boundary = 'fluo-file-pull-gate';
    const chunks = [
      TEXT_ENCODER.encode(
        `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\n\r\n`,
      ),
      TEXT_ENCODER.encode(`payload\r\n--${boundary}--\r\n`),
    ];
    const next = vi.fn<() => Promise<IteratorResult<Uint8Array>>>(async () => {
      const value = chunks.shift();
      return value
        ? { done: false as const, value }
        : { done: true as const, value: undefined };
    });
    const parts = parseMultipartStream({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      [Symbol.asyncIterator]() {
        return {
          next,
          async return() {
            return { done: true, value: undefined };
          },
        };
      },
      url: 'http://localhost/uploads',
    });

    // When
    const first = await parts.next();

    // Then
    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected an active multipart file.');
    }

    expect(next).toHaveBeenCalledTimes(1);

    await expect(new Response(first.value.stream).text()).resolves.toBe('payload');
  });

  it('cancels and unlocks the source when a field exceeds its limit', async () => {
    // Given
    const boundary = 'fluo-field-limit';
    let cancellationReason: unknown;
    const source = createChunkedMultipartRequest(boundary, [
      `--${boundary}\r\ncontent-disposition: form-data; name="title"\r\n\r\n${'x'.repeat(64)}`,
    ], {
      holdAfterChunks: true,
      onCancel(reason) {
        cancellationReason = reason;
      },
    });

    // When
    const result = parseMultipartStream(source.request, { maxFieldSize: 4 }).next();

    // Then
    await expect(result).rejects.toThrow('Field exceeds the maximum size of 4 bytes.');
    expect(cancellationReason).toBeInstanceOf(PayloadTooLargeException);
    expect(source.body.locked).toBe(false);
  });

  it.each([
    {
      body: 'not-the-declared-boundary\r\n',
      message: 'Multipart body does not start with its declared boundary.',
      name: 'initial boundary',
    },
    {
      body: '--fluo-parser-errors\r\ncontent-disposition form-data\r\n\r\nvalue\r\n--fluo-parser-errors--\r\n',
      message: 'Multipart part contains a malformed header.',
      name: 'malformed header',
    },
    {
      body: '--fluo-parser-errors\r\ncontent-disposition: form-data; name="title"\r\ncontent-disposition: form-data; name="duplicate"\r\n\r\nvalue\r\n--fluo-parser-errors--\r\n',
      message: 'Multipart part contains a repeated "content-disposition" header.',
      name: 'repeated header',
    },
    {
      body: '--fluo-parser-errors\r\ncontent-disposition: attachment; name="title"\r\n\r\nvalue\r\n--fluo-parser-errors--\r\n',
      message: 'Multipart parts require a form-data Content-Disposition header.',
      name: 'invalid content disposition',
    },
    {
      body: '--fluo-parser-errors\r\ncontent-disposition: form-data; name="title"\r\n\r\nvalue',
      message: 'Multipart body ended before its closing boundary.',
      name: 'premature EOF',
    },
  ])('releases the source after a $name parser error', async ({ body, message }) => {
    // Given
    const source = createChunkedMultipartRequest('fluo-parser-errors', [body]);

    // When
    const result = parseMultipartStream(source.request).next();

    // Then
    await expect(result).rejects.toThrow(message);
    expect(source.body.locked).toBe(false);
  });

  it('cancels the parser and source when an active file stream is cancelled', async () => {
    const boundary = 'fluo-cancel-stream';
    let cancellationReason: unknown;
    const source = createChunkedMultipartRequest(boundary, [
      `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\ncontent-type: text/plain\r\n\r\nhello`,
    ], {
      holdAfterChunks: true,
      onCancel(reason) {
        cancellationReason = reason;
      },
    });
    const parts = parseMultipartStream(source.request);
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    await first.value.stream.cancel('consumer stopped');

    expect(cancellationReason).toBe('consumer stopped');
    expect(source.body.locked).toBe(false);
    await expect(parts.next()).rejects.toThrow('consumer stopped');
  });

  it('preserves a source read rejection while releasing an active file stream', async () => {
    // Given
    const boundary = 'fluo-read-rejection';
    const sourceFailure = new Error('upstream reader failed');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(sourceFailure);
      },
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode(
          `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\n\r\n`,
        ));
      },
    });
    const parts = parseMultipartStream({
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      url: 'http://localhost/uploads',
    });
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    // When
    const fileReader = first.value.stream.getReader();

    // Then
    await expect(fileReader.read()).rejects.toBe(sourceFailure);
    await expect(parts.next()).rejects.toBe(sourceFailure);
    expect(body.locked).toBe(false);
  });

  it('propagates aborts to active file streams and rejects double body consumption', async () => {
    const boundary = 'fluo-abort-stream';
    const controller = new AbortController();
    let cancellationReason: unknown;
    const source = createChunkedMultipartRequest(boundary, [
      `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\n\r\nhello`,
      `\r\n--${boundary}--\r\n`,
    ], {
      holdAfterChunks: true,
      onCancel(reason) {
        cancellationReason = reason;
      },
      signal: controller.signal,
    });
    const parts = parseMultipartStream(source.request);
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    const reader = first.value.stream.getReader();

    controller.abort(new Error('client disconnected'));

    await expect(reader.read()).rejects.toThrow('client disconnected');
    expect(cancellationReason).toBeInstanceOf(Error);
    expect(source.body.locked).toBe(false);

    expect(() => parseMultipartStream(source.request)).toThrow(
      'Multipart request body has already been consumed.',
    );
  });

  it('continues with the following field after an empty nonfinal field', async () => {
    const boundary = 'fluo-empty-field';
    const parts = parseMultipartStream(createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="empty"'],
          value: '',
        },
        {
          headers: ['content-disposition: form-data; name="following"'],
          value: 'parsed',
        },
      ]),
    ]).request);

    await expect(parts.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'field', name: 'empty', value: '' },
    });
    await expect(parts.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'field', name: 'following', value: 'parsed' },
    });
  });

  it('continues with the following field after an empty nonfinal file', async () => {
    const boundary = 'fluo-empty-file';
    const parts = parseMultipartStream(createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: [
            'content-disposition: form-data; name="upload"; filename="empty.txt"',
            'content-type: text/plain',
          ],
          value: '',
        },
        {
          headers: ['content-disposition: form-data; name="following"'],
          value: 'parsed',
        },
      ]),
    ]).request);
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected an empty file multipart part.');
    }

    await expect(new Response(first.value.stream).text()).resolves.toBe('');
    await expect(parts.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'field', name: 'following', value: 'parsed' },
    });
  });

  it('preserves boundary-like file bytes until a complete valid suffix arrives', async () => {
    const boundary = 'fluo-boundary-like';
    const fileBytes = `before\r\n--${boundary}Xafter`;
    const source = createChunkedMultipartRequest(boundary, [
      `--${boundary}\r\ncontent-disposition: form-data; name="upload"; filename="payload.txt"\r\n\r\nbefore\r\n--${boundary}`,
      `Xafter\r\n--${boundary}-`,
      '-\r',
      '\n',
    ]);
    const parts = parseMultipartStream(source.request);
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected a file multipart part.');
    }

    await expect(new Response(first.value.stream).text()).resolves.toBe(fileBytes);
    await expect(parts.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('fails promptly while cancellation remains pending and releases after it settles', async () => {
    const boundary = 'fluo-pending-cancel';
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return new Promise<void>(() => {});
      },
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('not-the-declared-boundary'));
      },
    });
    const parts = parseMultipartStream({
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      url: 'http://localhost/uploads',
    });

    await expect(parts.next()).rejects.toThrow('Multipart body does not start with its declared boundary.');
  });

  it('keeps the parser failure when source cancellation rejects', async () => {
    const boundary = 'fluo-rejected-cancel';
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error('source cancellation rejected'));
      },
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('not-the-declared-boundary'));
      },
    });
    const parts = parseMultipartStream({
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      url: 'http://localhost/uploads',
    });

    await expect(parts.next()).rejects.toThrow('Multipart body does not start with its declared boundary.');
    expect(body.locked).toBe(false);
  });

  it('cancels and unlocks content-length preflight failures before iteration', async () => {
    const boundary = 'fluo-content-length-preflight';
    let cancellationReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    const parts = parseMultipartStream({
      body,
      headers: {
        'content-length': '1024',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
      url: 'http://localhost/uploads',
    }, { maxTotalSize: 1 });

    await expect(parts.next()).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(cancellationReason).toBeInstanceOf(PayloadTooLargeException);
    expect(body.locked).toBe(false);
  });

  it('drains epilogue bytes through EOF and enforces the total-size limit', async () => {
    const boundary = 'fluo-terminal-drain';
    const closing = createMultipartBody(boundary, []);
    const source = createChunkedMultipartRequest(boundary, [`${closing}epilogue`]);
    const maxTotalSize = TEXT_ENCODER.encode(closing).byteLength;
    const parts = parseMultipartStream(source.request, { maxTotalSize });

    await expect(parts.next()).rejects.toThrow(
      `Multipart body exceeds the maximum size of ${String(maxTotalSize)} bytes.`,
    );
    expect(source.body.locked).toBe(false);
  });

  it('reserves consumption when called and rejects a second iterator clearly', () => {
    const boundary = 'fluo-eager-reservation';
    const source = createChunkedMultipartRequest(boundary, [createMultipartBody(boundary, [])]);

    parseMultipartStream(source.request);

    expect(() => parseMultipartStream(source.request)).toThrow(MultipartBodyConsumedError);
  });

  it('rejects advancing before an active file stream settles', async () => {
    const boundary = 'fluo-active-file';
    const parts = parseMultipartStream(createChunkedMultipartRequest(boundary, [
      createMultipartBody(boundary, [
        {
          headers: ['content-disposition: form-data; name="first"; filename="first.txt"'],
          value: 'one',
        },
        {
          headers: ['content-disposition: form-data; name="second"; filename="second.txt"'],
          value: 'two',
        },
      ]),
    ]).request);
    const first = await parts.next();

    if (first.done || first.value.kind !== 'file') {
      throw new TypeError('Expected the first file multipart part.');
    }

    await expect(parts.next()).rejects.toThrow(
      'Consume or cancel the active multipart file stream before reading the next part.',
    );
    await first.value.stream.cancel(new Error('active-file test cleanup'));
  });

  it('cancels an async-iterable source when iteration returns early', async () => {
    const boundary = 'fluo-async-iterable';
    let released = false;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            return {
              done: false,
              value: TEXT_ENCODER.encode(createMultipartBody(boundary, [
                {
                  headers: ['content-disposition: form-data; name="title"'],
                  value: 'Ada',
                },
              ])),
            };
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            released = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const parts = parseMultipartStream({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      [Symbol.asyncIterator]: source[Symbol.asyncIterator],
      url: 'http://localhost/uploads',
    });

    await parts.return?.(undefined);

    expect(released).toBe(true);
  });

  it('does not pull an async-iterable body before the parser needs bytes', async () => {
    const boundary = 'fluo-gated-pull';
    let pulls = 0;
    const source = {
      async *[Symbol.asyncIterator]() {
        pulls += 1;
        yield TEXT_ENCODER.encode(createMultipartBody(boundary, []));
      },
    };
    const parts = parseMultipartStream({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      [Symbol.asyncIterator]: source[Symbol.asyncIterator],
      url: 'http://localhost/uploads',
    });

    expect(pulls).toBe(0);
    await expect(parts.next()).resolves.toEqual({ done: true, value: undefined });
    expect(pulls).toBe(1);
  });

  it('uses the stored abort reason when a pending read completes as done', async () => {
    const boundary = 'fluo-abort-after-done';
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start() {},
    });
    const parts = parseMultipartStream({
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
      signal: abort.signal,
      url: 'http://localhost/uploads',
    });
    const result = parts.next();

    abort.abort(new Error('client disconnected while pending'));

    await expect(result).rejects.toThrow('client disconnected while pending');
    expect(body.locked).toBe(false);
  });
});

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}
