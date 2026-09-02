import type { ServerResponse } from 'node:http';

import type { FrameworkResponseStream } from '@fluojs/http';

/**
 * Adapt a native Node response to the framework streaming contract.
 *
 * @param response Native response to adapt.
 * @returns A framework stream that manages the response lifecycle.
 */
export function createFrameworkResponseStream(response: ServerResponse): FrameworkResponseStream {
  return {
    close() {
      if (!response.writableEnded) {
        response.end();
      }
    },
    get closed() {
      return response.writableEnded;
    },
    disableCompression() {
      disableNativeCompression(response);
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
    onError(listener: (error: unknown) => void) {
      response.on('error', listener);
      return () => {
        response.removeListener('error', listener);
      };
    },
    waitForDrain() {
      if (response.writableEnded || response.destroyed) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          response.removeListener('drain', resolveDrain);
          response.removeListener('close', resolveDrain);
          response.removeListener('error', rejectError);
        };
        const rejectError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const resolveDrain = () => {
          cleanup();
          resolve();
        };

        response.once('drain', resolveDrain);
        response.once('close', resolveDrain);
        response.once('error', rejectError);
      });
    },
    write(chunk: string | Uint8Array) {
      return response.write(chunk);
    },
  };
}

function disableNativeCompression(response: ServerResponse): void {
  const cacheControl = response.getHeader('cache-control');
  const value = Array.isArray(cacheControl) ? cacheControl.join(', ') : String(cacheControl ?? '');

  if (!/\bno-transform\b/i.test(value)) {
    response.setHeader('Cache-Control', value ? `${value}, no-transform` : 'no-transform');
  }
}
