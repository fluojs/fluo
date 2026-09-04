import type { ServerResponse } from 'node:http';

import {
  createErrorResponse,
  type FrameworkResponse,
  type FrameworkResponseCompression,
  type FrameworkResponseStream,
  HttpException,
  InternalServerErrorException,
} from '@fluojs/http';

import { createNodeEarlyHintsCapability } from './internal-node-early-hints.js';
import { createFrameworkResponseStream } from './internal-node-response-stream.js';

/**
 * Defines the mutable framework response type.
 */
export type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

type FrameworkResponseCompressionFactory = () => FrameworkResponseCompression | undefined;

/**
 * Create framework response.
 *
 * @param response The response.
 * @param compression The compression.
 * @returns The create framework response result.
 */
export function createFrameworkResponse(
  response: ServerResponse,
  compression?: FrameworkResponseCompression | FrameworkResponseCompressionFactory,
): MutableFrameworkResponse {
  let activeStream: FrameworkResponseStream | undefined;
  const resolveCompression = (() => {
    const factory = typeof compression === 'function'
      ? compression as FrameworkResponseCompressionFactory
      : () => compression;
    let resolved = false;
    let value: FrameworkResponseCompression | undefined;

    return () => {
      if (!resolved) {
        value = factory();
        resolved = true;
      }

      return value;
    };
  })();

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

  let frameworkResponse: MutableFrameworkResponse & { raw: ServerResponse };
  frameworkResponse = {
    committed: response.headersSent || response.writableEnded,
    earlyHints: createNodeEarlyHintsCapability(response, () => frameworkResponse.committed),
    headers: {},
    raw: response,
    get stream() {
      activeStream ??= createFrameworkResponseStream(response);
      return activeStream;
    },
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      void this.send(undefined);
    },
    send(body: unknown, options?: { readonly compression?: boolean }) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      const hasContentType = response.hasHeader('Content-Type');
      const existingContentType = response.getHeader('Content-Type');
      const serialized = serializeResponseBody(
        body,
        typeof existingContentType === 'string' ? existingContentType : undefined,
      );
      const adapterDefaultContentType = hasContentType
        ? undefined
        : serialized.defaultContentType;

      if (adapterDefaultContentType) {
        response.setHeader('Content-Type', adapterDefaultContentType);
      }

      const contentType = response.getHeader('Content-Type') as string | undefined;
      const payload = typeof serialized.payload === 'string'
        ? Buffer.from(serialized.payload, 'utf8')
        : serialized.payload;

      if (
        options?.compression !== false
        &&
        response.statusCode !== 206
        && !response.hasHeader('Content-Range')
      ) {
        const activeCompression = resolveCompression();

        if (activeCompression) {
          this.committed = true;

          return Promise.resolve()
            .then(() => activeCompression.write(payload, { contentType }))
            .then((handled) => {
              if (!handled && !response.writableEnded) {
                response.end(payload);
              }
            })
            .catch((error: unknown) => {
              if (response.headersSent || response.writableEnded || response.destroyed) {
                if (!response.writableEnded && !response.destroyed) {
                  response.destroy();
                }
              } else {
                response.removeHeader('Content-Encoding');
                if (adapterDefaultContentType) {
                  response.removeHeader('Content-Type');
                }
                this.committed = false;
              }

              throw error;
            });
        }
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

/**
 * Write node adapter error response.
 *
 * @param error The error.
 * @param response The response.
 * @param requestId The request id.
 * @returns The write node adapter error response result.
 */
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
