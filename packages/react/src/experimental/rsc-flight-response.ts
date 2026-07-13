import type { FrameworkResponse, RequestContext } from '@fluojs/http';

import {
  collectReadableStream,
  pipeReadableStream,
  throwIfReactRequestAborted,
} from '../render-stream.js';
import {
  REACT_RSC_FLIGHT_CONTENT_TYPE,
  type ReactFlightPayload,
  type ReactFlightResponse,
  type ReactFlightResponseHeaders,
  type ReactFlightResponseOptions,
} from './rsc-types.js';

const responseWriterKey = Symbol.for('fluo.http.responseWriter');

type ReactFlightResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: RequestContext;
  readonly response: FrameworkResponse;
};

function cloneHeaders(headers: ReactFlightResponseHeaders | undefined): ReactFlightResponseHeaders {
  const snapshot: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    snapshot[name] = typeof value === 'string' ? value : [...value];
  }

  return snapshot;
}

function clonePayload(payload: ReactFlightPayload): ReactFlightPayload {
  return payload instanceof Uint8Array ? new Uint8Array(payload) : payload;
}

function isBufferedPayload(payload: ReactFlightPayload): payload is string | Uint8Array {
  return typeof payload === 'string' || payload instanceof Uint8Array;
}

function applyFlightResponseMetadata(
  entry: ReactFlightResponse,
  context: ReactFlightResponseWriterContext,
): void {
  context.applySuccessResponseMetadata();

  if (entry.status !== undefined) {
    context.response.setStatus(entry.status);
  }

  for (const [name, value] of Object.entries(entry.headers)) {
    if (name.toLowerCase() === 'content-type') {
      continue;
    }

    context.response.setHeader(name, typeof value === 'string' ? value : [...value]);
  }

  context.response.setHeader('Content-Type', REACT_RSC_FLIGHT_CONTENT_TYPE);
}

async function writeReactFlightResponse(
  entry: ReactFlightResponse,
  context: ReactFlightResponseWriterContext,
): Promise<void> {
  throwIfReactRequestAborted(context.requestContext.request);

  if (isBufferedPayload(entry.payload)) {
    applyFlightResponseMetadata(entry, context);
    await context.response.send(entry.payload);
    return;
  }

  const responseStream = context.response.stream;

  if (!responseStream) {
    const body = await collectReadableStream(entry.payload, context.requestContext.request);
    throwIfReactRequestAborted(context.requestContext.request);
    applyFlightResponseMetadata(entry, context);
    await context.response.send(body);
    return;
  }

  applyFlightResponseMetadata(entry, context);
  context.response.committed = true;
  responseStream.flush?.();
  await pipeReadableStream(entry.payload, responseStream, context.requestContext.request);
}

/**
 * Creates an experimental Flight payload response for an ordinary fluo HTTP handler.
 *
 * @remarks
 * The caller owns Flight encoding. Returning this entry from `@Get(...)`, `@Post(...)`, or
 * `@Path(...)` keeps route matching, middleware, guards, interceptors, request scopes, and adapter
 * response writing in the existing fluo HTTP dispatcher. A stream payload is consumed once.
 *
 * @param payload Application-encoded Flight bytes, text, or Web `ReadableStream`.
 * @param options Optional status and headers applied after ordinary route success metadata.
 * @returns A response entry recognized by the existing fluo HTTP dispatch response policy.
 */
export function createReactFlightResponse(
  payload: ReactFlightPayload,
  options: ReactFlightResponseOptions = {},
): ReactFlightResponse {
  const entry: ReactFlightResponse = {
    headers: cloneHeaders(options.headers),
    payload: clonePayload(payload),
    ...(options.status !== undefined ? { status: options.status } : {}),
  };

  Object.defineProperty(entry, responseWriterKey, {
    enumerable: false,
    value: (context: ReactFlightResponseWriterContext): Promise<void> => writeReactFlightResponse(entry, context),
  });

  return entry;
}
