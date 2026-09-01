import {
  type ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from 'node:http';

import {
  createErrorResponse,
  type EarlyHintsHeaders,
  EarlyHintsWriteError,
  type FrameworkResponse,
  type FrameworkResponseCompression,
  type FrameworkResponseEarlyHints,
  type FrameworkResponseStream,
  HttpException,
  InternalServerErrorException,
  RequestAbortedError,
} from '@fluojs/http';

/**
 * Defines the mutable framework response type.
 */
export type MutableFrameworkResponse = FrameworkResponse & { statusSet?: boolean };

type FrameworkResponseCompressionFactory = () => FrameworkResponseCompression | undefined;

/**
 * Create the request-scoped Early Hints writer shared by Node-backed adapters.
 *
 * @param response Native Node response that emits HTTP 103 informational responses.
 * @param isCommitted Probe for facade-level final response ownership.
 * @returns An Early Hints capability that settles on native write, error, or disconnect.
 */
export function createNodeEarlyHintsCapability(
  response: ServerResponse,
  isCommitted: () => boolean,
): FrameworkResponseEarlyHints {
  return {
    write(headers: EarlyHintsHeaders): Promise<void> {
      if (isCommitted() || response.headersSent || response.writableEnded) {
        return Promise.reject(new EarlyHintsWriteError(
          'Cannot write HTTP 103 Early Hints after the final response is committed.',
        ));
      }

      if (response.destroyed || response.socket?.destroyed) {
        return Promise.reject(new RequestAbortedError(
          'Request aborted before HTTP 103 Early Hints could be written.',
        ));
      }

      let nativeHeaders: Record<string, string | string[]>;
      try {
        nativeHeaders = cloneEarlyHintsHeaders(headers);
      } catch (cause: unknown) {
        return Promise.reject(new EarlyHintsWriteError(
          'HTTP 103 Early Hints contains an invalid header name or value.',
          { cause },
        ));
      }

      if (!hasNonEmptyLink(nativeHeaders.link)) {
        return Promise.reject(new EarlyHintsWriteError(
          'HTTP 103 Early Hints requires at least one non-empty link value.',
        ));
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          response.removeListener('close', onClose);
          response.removeListener('error', onError);
        };
        const settle = (action: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          action();
        };
        const onClose = () => {
          settle(() => reject(new RequestAbortedError(
            'Request aborted while HTTP 103 Early Hints were being written.',
          )));
        };
        const onError = (cause: Error) => {
          settle(() => reject(new EarlyHintsWriteError(
            'Native HTTP transport failed to write HTTP 103 Early Hints.',
            { cause },
          )));
        };
        const onWritten = () => {
          settle(resolve);
        };

        response.once('close', onClose);
        response.once('error', onError);

        try {
          response.writeEarlyHints(nativeHeaders, onWritten);
        } catch (cause: unknown) {
          settle(() => reject(new EarlyHintsWriteError(
            'Native HTTP transport rejected HTTP 103 Early Hints.',
            { cause },
          )));
        }
      });
    },
  };
}

function hasNonEmptyLink(link: unknown): link is EarlyHintsHeaders['link'] {
  return typeof link === 'string'
    ? link.length > 0
    : Array.isArray(link)
      && link.length > 0
      && link.every((value) => typeof value === 'string' && value.length > 0);
}

function cloneEarlyHintsHeaders(
  headers: EarlyHintsHeaders,
): Record<string, string | string[]> {
  const cloned: Record<string, string | string[]> = Object.create(null);
  const names = new Set<string>();

  for (const [name, value] of Object.entries(headers)) {
    validateHeaderName(name);
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'content-length' || normalizedName === 'transfer-encoding') {
      throw new TypeError(`Header is not permitted in HTTP 103 Early Hints: ${name}`);
    }
    if (names.has(normalizedName)) {
      throw new TypeError(`Duplicate Early Hints header name: ${name}`);
    }
    names.add(normalizedName);

    if (typeof value === 'string') {
      validateHeaderValue(name, value);
      cloned[normalizedName] = value;
      continue;
    }

    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw new TypeError(`Invalid Early Hints header value: ${name}`);
    }
    for (const entry of value) {
      validateHeaderValue(name, entry);
    }
    cloned[normalizedName] = [...value];
  }

  return cloned;
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

      if (activeCompression && response.statusCode !== 206 && !response.hasHeader('Content-Range')) {
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
