import type { ServerResponse } from 'node:http';

import {
  createErrorResponse,
  HttpException,
  InternalServerException,
  type FrameworkResponse,
} from '@konekti/http';

import { compressResponse } from './compression.js';

export type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

export function createFrameworkResponse(response: ServerResponse, acceptEncoding?: string): MutableFrameworkResponse {
  const frameworkResponse: MutableFrameworkResponse & { raw: ServerResponse } = {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    raw: response,
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      void this.send(undefined);
    },
    send(body: unknown) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      const existingContentType = response.getHeader('Content-Type');
      const serialized = serializeResponseBody(
        body,
        typeof existingContentType === 'string' ? existingContentType : undefined,
      );

      if (!response.hasHeader('Content-Type') && serialized.defaultContentType) {
        response.setHeader('Content-Type', serialized.defaultContentType);
      }

      const contentType = response.getHeader('Content-Type') as string | undefined;
      const payload = typeof serialized.payload === 'string'
        ? Buffer.from(serialized.payload, 'utf8')
        : serialized.payload;

      if (acceptEncoding && payload.byteLength >= 256) {
        this.committed = true;

        compressResponse(response, payload, acceptEncoding, contentType).catch(() => {
          if (!response.writableEnded) {
            response.end();
          }
        });

        return;
      }

      response.end(payload);
      this.committed = true;
    },
    setHeader(name: string, value: string) {
      response.setHeader(name, value);
      this.headers[name] = value;
    },
    setStatus(code: number) {
      response.statusCode = code;
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };

  return frameworkResponse;
}

export async function writeNodeAdapterErrorResponse(
  error: unknown,
  response: FrameworkResponse,
  requestId?: string,
): Promise<void> {
  const httpError = toHttpException(error);
  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
}

function serializeResponseBody(
  body: unknown,
  contentType?: string,
): { defaultContentType?: string; payload: Buffer | string } {
  if (body === undefined) {
    return { payload: '' };
  }

  if (Buffer.isBuffer(body)) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: body,
    };
  }

  if (body instanceof Uint8Array) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      defaultContentType: 'application/octet-stream',
      payload: Buffer.from(body),
    };
  }

  if (typeof body === 'string') {
    return {
      defaultContentType: isJsonContentType(contentType) ? undefined : 'text/plain; charset=utf-8',
      payload: isJsonContentType(contentType) ? JSON.stringify(body) : body,
    };
  }

  return {
    defaultContentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(body),
  };
}

function isJsonContentType(contentType: string | undefined): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}
