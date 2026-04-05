import { describe, expect, it } from 'vitest';

import { PayloadTooLargeException } from '@konekti/http';

import { parseMultipart } from './multipart.js';

describe('parseMultipart', () => {
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
          buffer: Buffer.from('hello'),
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
          buffer: Buffer.from('hello'),
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
});
