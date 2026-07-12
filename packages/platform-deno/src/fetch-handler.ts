import type { Dispatcher } from '@fluojs/http/internal';
import type { MultipartOptions } from '@fluojs/runtime';
import { createWebRequestResponseFactory, dispatchWebRequest } from '@fluojs/runtime/web';

import type { DenoServeHandler } from './adapter.js';
import { validateNonNegativeIntegerOption } from './options.js';

/** Options for creating a Deno request handler for a host-owned `Deno.serve(...)` lifecycle. */
export interface CreateDenoFetchHandlerOptions {
  /** Already bootstrapped dispatcher that receives translated fluo framework requests. */
  readonly dispatcher: Dispatcher;
  /** Maximum request body size enforced by the shared Web request parser. */
  readonly maxBodySize?: number;
  /** Multipart parsing limits enforced by the shared Web request parser. */
  readonly multipart?: MultipartOptions;
  /** Preserves byte-exact raw bodies for JSON and text requests when enabled. */
  readonly rawBody?: boolean;
}

/**
 * Create a Deno `Request` handler without starting or owning `Deno.serve(...)`.
 *
 * @remarks
 * The surrounding host owns server startup, shutdown, signals, and websocket upgrades. The
 * dispatcher must come from an already bootstrapped fluo application, such as `app.dispatcher`.
 *
 * @param options - Bootstrapped dispatcher and shared Web request parsing options.
 * @returns A handler suitable for a host-owned `Deno.serve(handler)` call.
 */
export function createDenoFetchHandler({
  dispatcher,
  maxBodySize,
  multipart,
  rawBody,
}: CreateDenoFetchHandlerOptions): DenoServeHandler {
  validateNonNegativeIntegerOption('maxBodySize', maxBodySize);

  const factory = createWebRequestResponseFactory({
    maxBodySize,
    multipart,
    rawBody,
  });

  return async function denoFetchHandler(request: Request): Promise<Response> {
    return await dispatchWebRequest({
      dispatcher,
      dispatcherNotReadyMessage: 'Deno fetch handler received a request before dispatcher binding completed.',
      factory,
      request,
    });
  };
}
