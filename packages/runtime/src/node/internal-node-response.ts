import type { ServerResponse } from 'node:http';

import {
  createErrorResponse,
  type FrameworkResponse,
  type FrameworkResponseCompression,
  type FrameworkResponseStream,
  HttpException,
  InternalServerErrorException,
} from '@fluojs/http';

/**
 * Defines the mutable framework response type.
 */
export type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

type FrameworkResponseCompressionFactory = () => FrameworkResponseCompression | undefined;

const NativeArray = Array;
const nativeArrayIsArray = Array.isArray;
const nativeObjectDefineProperty = Object.defineProperty;
const nativeObjectKeys = Object.keys;
const nativeReflectDeleteProperty = Reflect.deleteProperty;
const nativeStringToLowerCase = Function.prototype.call.bind(String.prototype.toLowerCase);
const SET_COOKIE_HEADER_NAME = 'set-cookie';

type SetCookieHeaderValue = string | string[];

function copySetCookieHeaderValue(value: SetCookieHeaderValue): string[] {
  if (!nativeArrayIsArray(value)) {
    return [value];
  }

  const copied = new NativeArray<string>(value.length);

  for (let index = 0; index < value.length; index += 1) {
    nativeObjectDefineProperty(copied, index, {
      configurable: true,
      enumerable: true,
      value: value[index],
      writable: true,
    });
  }

  return copied;
}

function mergeSetCookieHeaderValues(
  current: SetCookieHeaderValue | number | undefined,
  incoming: SetCookieHeaderValue,
): SetCookieHeaderValue {
  const incomingValues = copySetCookieHeaderValue(incoming);

  if (current === undefined || typeof current === 'number') {
    return incomingValues.length === 1 ? incomingValues[0] : incomingValues;
  }

  const currentValues = copySetCookieHeaderValue(current);
  const merged = new NativeArray<string>(currentValues.length + incomingValues.length);

  for (let index = 0; index < currentValues.length; index += 1) {
    nativeObjectDefineProperty(merged, index, {
      configurable: true,
      enumerable: true,
      value: currentValues[index],
      writable: true,
    });
  }

  for (let index = 0; index < incomingValues.length; index += 1) {
    nativeObjectDefineProperty(merged, currentValues.length + index, {
      configurable: true,
      enumerable: true,
      value: incomingValues[index],
      writable: true,
    });
  }

  return merged;
}

function setSetCookieMirrorHeader(
  headers: Record<string, SetCookieHeaderValue>,
  name: string,
  value: SetCookieHeaderValue,
): void {
  const keys = nativeObjectKeys(headers);
  let targetName: string | undefined;

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];

    if (nativeStringToLowerCase(key) !== SET_COOKIE_HEADER_NAME) {
      continue;
    }

    if (targetName === undefined) {
      targetName = key;
      continue;
    }

    nativeReflectDeleteProperty(headers, key);
  }

  nativeObjectDefineProperty(headers, targetName ?? name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

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
      if (response.writableEnded || response.destroyed) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const settle = () => {
          response.removeListener('drain', settle);
          response.removeListener('close', settle);
          response.removeListener('error', settle);
          resolve();
        };

        response.once('drain', settle);
        response.once('close', settle);
        response.once('error', settle);
      });
    },
    write(chunk: string | Uint8Array) {
      return response.write(chunk);
    },
  };
}

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

  const frameworkResponse: MutableFrameworkResponse & { raw: ServerResponse } = {
    committed: response.headersSent || response.writableEnded,
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
      const activeCompression = resolveCompression();

      if (activeCompression) {
        this.committed = true;

        return Promise.resolve(activeCompression.write(payload, { contentType }))
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
      const headers = this.headers as Record<string, SetCookieHeaderValue>;
      const lowerName = nativeStringToLowerCase(name);

      if (lowerName === SET_COOKIE_HEADER_NAME) {
        const merged = mergeSetCookieHeaderValues(response.getHeader(SET_COOKIE_HEADER_NAME), value);
        response.setHeader(SET_COOKIE_HEADER_NAME, merged);
        setSetCookieMirrorHeader(headers, name, merged);
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
