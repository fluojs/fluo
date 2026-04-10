import { createBrotliCompress, createGzip, type BrotliCompress, type Gzip } from 'node:zlib';
import type { ServerResponse } from 'node:http';

import type {
  FrameworkResponseCompression,
  FrameworkResponseCompressionWriteOptions,
} from '@fluojs/http';

const COMPRESS_THRESHOLD = 1024;

const SKIP_CONTENT_TYPES = new Set([
  'image/',
  'audio/',
  'video/',
  'application/zip',
  'application/gzip',
  'application/x-bzip',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/octet-stream',
]);

type Encoding = 'br' | 'gzip' | 'identity';

export function createNodeResponseCompression(
  response: ServerResponse,
  acceptEncoding: string | undefined,
): FrameworkResponseCompression | undefined {
  if (!acceptEncoding) {
    return undefined;
  }

  return {
    async write(body: Uint8Array, options: FrameworkResponseCompressionWriteOptions = {}) {
      if (body.byteLength < COMPRESS_THRESHOLD || shouldSkipContentType(options.contentType)) {
        return false;
      }

      const encoding = selectEncoding(acceptEncoding);

      if (encoding === 'identity') {
        return false;
      }

      await compressNodeResponse(response, body, encoding);
      return true;
    },
  };
}

export function compressNodeResponse(
  response: ServerResponse,
  body: Uint8Array,
  encoding: Exclude<Encoding, 'identity'>,
): Promise<void> {
  const stream: BrotliCompress | Gzip = encoding === 'br' ? createBrotliCompress() : createGzip();

  response.setHeader('Content-Encoding', encoding);
  response.removeHeader('Content-Length');

  return new Promise((resolve, reject) => {
    stream.on('error', reject);

    stream.pipe(response);
    stream.on('finish', resolve);

    stream.end(body);
  });
}

function shouldSkipContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const lower = contentType.toLowerCase();

  for (const prefix of SKIP_CONTENT_TYPES) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function selectEncoding(acceptEncoding: string | undefined): Encoding {
  if (!acceptEncoding) {
    return 'identity';
  }

  const entries = acceptEncoding
    .split(',')
    .map((entry) => {
      const [enc, qPart] = entry.trim().split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1;

      return { enc: enc?.trim() ?? '', q: Number.isNaN(q) ? 1 : q };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { enc } of entries) {
    if (enc === 'br') {
      return 'br';
    }

    if (enc === 'gzip') {
      return 'gzip';
    }
  }

  return 'identity';
}
