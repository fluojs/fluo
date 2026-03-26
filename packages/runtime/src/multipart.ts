import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';

import { PayloadTooLargeException } from '@konekti/http';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface MultipartOptions {
  maxFileSize?: number;
  maxFiles?: number;
}

export interface MultipartResult {
  fields: Record<string, string | string[]>;
  files: UploadedFile[];
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;

export function parseMultipart(request: IncomingMessage, options: MultipartOptions = {}): Promise<MultipartResult> {
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: request.headers,
      limits: { fileSize: maxFileSize, files: maxFiles },
    });

    const fields: Record<string, string | string[]> = {};
    const files: UploadedFile[] = [];
    let fileCount = 0;
    let settled = false;

    const rejectOnce = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    bb.on('field', (name, value) => {
      const existing = fields[name];

      if (existing === undefined) {
        fields[name] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fields[name] = [existing, value];
      }
    });

    bb.on('file', (fieldname, fileStream, info) => {
      fileCount++;

      if (fileCount > maxFiles) {
        fileStream.resume();
        rejectOnce(new PayloadTooLargeException(`Exceeded maximum file count of ${String(maxFiles)}.`));
        request.unpipe(bb);
        bb.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;

      fileStream.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;

        if (totalSize > maxFileSize) {
          fileStream.destroy();
          rejectOnce(new PayloadTooLargeException(`File "${fieldname}" exceeds the maximum size of ${String(maxFileSize)} bytes.`));
          return;
        }

        chunks.push(chunk);
      });

      fileStream.on('end', () => {
        files.push({
          buffer: Buffer.concat(chunks),
          fieldname,
          mimetype: info.mimeType,
          originalname: info.filename,
          size: totalSize,
        });
      });

      fileStream.on('error', rejectOnce);
    });

    bb.on('finish', () => {
      if (!settled) {
        settled = true;
        resolve({ fields, files });
      }
    });

    bb.on('error', rejectOnce);

    request.pipe(bb);
  });
}
