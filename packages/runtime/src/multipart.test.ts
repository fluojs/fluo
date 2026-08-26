import { PayloadTooLargeException } from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import { parseMultipart } from './multipart.js';

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

  it('does not reconstruct a Web Request while parsing buffered multipart bytes', async () => {
    const OriginalRequest = Request;
    const form = new FormData();
    form.append('name', 'Ada');
    const request = new OriginalRequest('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });

    const RequestWithoutReconstruction = (): never => {
      throw new TypeError('Buffered Web multipart parsing must not construct a second Request.');
    };
    Object.defineProperty(RequestWithoutReconstruction, Symbol.hasInstance, {
      value(value: unknown): boolean {
        return value instanceof OriginalRequest;
      },
    });
    vi.stubGlobal('Request', RequestWithoutReconstruction);

    try {
      await expect(parseMultipart(request)).resolves.toEqual({
        fields: { name: 'Ada' },
        files: [],
      });
    } finally {
      vi.unstubAllGlobals();
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

  it.each([
    ['space-padded regular delimiter', ' ', ''],
    ['tab-padded regular delimiter', '\t', ''],
    ['space-padded closing delimiter', '', ' '],
    ['tab-padded closing delimiter', '', '\t'],
  ])('parses a buffered multipart body with a %s', async (_name, regularPadding, closingPadding) => {
    const boundary = 'fluo-transport-padding';
    const request = new Request('http://localhost/uploads', {
      body: [
        `--${boundary}${regularPadding}\r\n`,
        'Content-Disposition: form-data; name="name"\r\n\r\n',
        `Ada\r\n--${boundary}--${closingPadding}\r\n`,
      ].join(''),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    await expect(parseMultipart(request)).resolves.toEqual({
      fields: { name: 'Ada' },
      files: [],
    });
  });

  it('parses a buffered multipart body with an RFC preamble', async () => {
    // Given
    const boundary = 'fluo-preamble';
    const request = new Request('http://localhost/uploads', {
      body: [
        'This preamble must be ignored by multipart recipients.\r\n',
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="name"\r\n\r\n',
        'Ada\r\n',
        `--${boundary}--\r\n`,
      ].join(''),
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    });

    // When
    const result = parseMultipart(request);

    // Then
    await expect(result).resolves.toEqual({
      fields: { name: 'Ada' },
      files: [],
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
    const form = new FormData();
    form.append('first', new Blob(['a'], { type: 'text/plain' }), 'first.txt');
    form.append('second', new Blob(['b'], { type: 'text/plain' }), 'second.txt');

    const request = new Request('http://localhost/uploads', {
      body: form,
      method: 'POST',
    });

    const result = parseMultipart(request, { maxFiles: 1 });

    await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(result).rejects.toThrow('Exceeded maximum file count of 1.');
  });

  it('rejects multipart payloads that exceed the configured total size limit', async () => {
    const result = parseMultipart(
      {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('12345678901'));
            controller.close();
          },
        }),
        headers: {
          'content-type': 'multipart/form-data; boundary=fluo-limit',
        },
        method: 'POST',
        url: 'http://localhost/uploads',
      },
      { maxTotalSize: 10 },
    );

    await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(result).rejects.toThrow('Multipart body exceeds the maximum size of 10 bytes.');
  });

  it('enforces total size while reading without calling arrayBuffer', async () => {
    const chunks = [
      new TextEncoder().encode('12345678'),
      new TextEncoder().encode('abcdefgh'),
    ];
    let index = 0;
    const request = new Request('http://localhost/uploads', {
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[index];
          index += 1;

          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }, { highWaterMark: 0 }),
      duplex: 'half',
      headers: {
        'content-type': 'multipart/form-data; boundary=fluo-limit',
      },
      method: 'POST',
    } as RequestInit & { duplex: 'half' });
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer').mockImplementation(() => {
      throw new Error('Buffered multipart must not allocate through Request.arrayBuffer().');
    });

    await expect(parseMultipart(request, { maxTotalSize: 10 })).rejects.toThrow(
      'Multipart body exceeds the maximum size of 10 bytes.',
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels total-size overflow promptly and releases the reader after cleanup', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('overflow'));
      },
      pull() {
        // Intentionally never closes: overflow cleanup must cancel instead of drain.
      },
    }, { highWaterMark: 0 });

    await expect(parseMultipart({
      body,
      headers: {
        'content-type': 'multipart/form-data; boundary=fluo-limit',
      },
      method: 'POST',
      url: 'http://localhost/uploads',
    }, { maxTotalSize: 4 })).rejects.toThrow(
      'Multipart body exceeds the maximum size of 4 bytes.',
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('does not prefetch another async-iterator chunk before overflow cleanup', async () => {
    let releaseFirstChunk!: (result: IteratorResult<Uint8Array>) => void;
    const firstChunk = new Promise<IteratorResult<Uint8Array>>((resolve) => {
      releaseFirstChunk = resolve;
    });
    const returnIterator = vi.fn(async () => ({
      done: true as const,
      value: undefined,
    }));
    let nextCalls = 0;
    const body: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1;

            if (nextCalls === 1) {
              return firstChunk;
            }

            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return: returnIterator,
        };
      },
    };
    const result = parseMultipart({
      body,
      headers: {
        'content-type': 'multipart/form-data; boundary=fluo-limit',
      },
      method: 'POST',
      url: 'http://localhost/uploads',
    }, { maxTotalSize: 4 });

    releaseFirstChunk({
      done: false as const,
      value: new TextEncoder().encode('overflow'),
    });

    await expect(result).rejects.toThrow(
      'Multipart body exceeds the maximum size of 4 bytes.',
    );
    expect(nextCalls).toBe(1);
    expect(returnIterator).toHaveBeenCalledOnce();
  });
});
