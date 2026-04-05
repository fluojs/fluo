import type { ServerResponse } from 'node:http';

import {
  createErrorResponse,
  HttpException,
  InternalServerErrorException,
  type FrameworkResponseCompression,
  type FrameworkResponse,
  type FrameworkResponseStream,
} from '@konekti/http';

export type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

function createFrameworkResponseStream(response: ServerResponse): FrameworkResponseStream {
  return {
    close() {
      if (!response.writableEnded) {
        response.end();
      }
    },
    get closed() {
      return response.writableEnded;
    },
    flush() {
      response.flushHeaders?.();
    },
    onClose(listener: () => void) {
      response.on('close', listener);
      return () => {
        response.removeListener('close', listener);
      };
    },
    waitForDrain() {
      if (response.writableEnded) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        response.once('drain', () => resolve());
      });
    },
    write(chunk: string | Uint8Array) {
      return response.write(chunk);
    },
  };
}

export function createFrameworkResponse(
  response: ServerResponse,
  compression?: FrameworkResponseCompression,
): MutableFrameworkResponse {
  const mergeSetCookieHeader = (
    current: string | string[] | number | undefined,
    incoming: string | string[],
  ): string | string[] => {
    const nextValues = Array.isArray(incoming) ? incoming : [incoming];

    if (current === undefined) {
      return nextValues.length === 1 ? nextValues[0] : [...nextValues];
    }

    if (typeof current === 'number') {
      return nextValues.length === 1 ? nextValues[0] : [...nextValues];
    }

    const currentValues = Array.isArray(current) ? current : [current];
    const merged = [...currentValues, ...nextValues];

    return merged.length === 1 ? merged[0] : merged;
  };

  const frameworkResponse: MutableFrameworkResponse & { raw: ServerResponse } = {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    raw: response,
    stream: createFrameworkResponseStream(response),
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

      if (compression) {
        this.committed = true;

        return Promise.resolve(compression.write(payload, { contentType }))
          .then((handled) => {
            if (!handled && !response.writableEnded) {
              response.end(payload);
            }
          })
          .catch(() => {
            if (!response.writableEnded) {
              response.end();
            }
          });
      }

      response.end(payload);
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      const headers = this.headers as Record<string, string | string[]>;
      const lowerName = name.toLowerCase();

      if (lowerName === 'set-cookie') {
        const merged = mergeSetCookieHeader(response.getHeader(name), value);
        response.setHeader(name, merged);
        headers[name] = merged;
        return;
      }

      response.setHeader(name, value);
      headers[name] = value;
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

  return new InternalServerErrorException('Internal server error.', {
    cause: error,
  });
}
