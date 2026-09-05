import {
  type ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from 'node:http';

import {
  type EarlyHintsHeaders,
  EarlyHintsWriteError,
  type FrameworkResponseEarlyHints,
  RequestAbortedError,
} from '@fluojs/http';

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
