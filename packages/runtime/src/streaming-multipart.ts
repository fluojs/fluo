import type { FrameworkRequestMultipart } from '@fluojs/http';

import type { MultipartOptions } from './multipart.js';
import { StreamingMultipartParser } from './streaming-multipart-parser.js';

/** Portable input accepted by the streaming multipart parser. */
export interface StreamingMultipartInput {
  /** Request byte stream or portable async byte iterable. */
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
  /** Full multipart `content-type` header containing a boundary parameter. */
  contentType: string;
  /** Multipart mode limits. */
  options?: MultipartOptions;
  /** Request cancellation signal propagated to parser and active file streams. */
  signal?: AbortSignal;
  /** Whether parser cancellation owns and propagates to the input source. */
  cancelSource?: boolean;
}

/**
 * Creates a single-consumer, backpressure-aware multipart body.
 *
 * @param input - Portable body stream, content type, limits, and abort signal.
 * @returns Multipart body claimed through `consume()` exactly once.
 */
export function createStreamingMultipart(input: StreamingMultipartInput): FrameworkRequestMultipart {
  const parser = new StreamingMultipartParser(input);
  let consumed = false;

  return {
    cancel: async (reason?: unknown) => parser.cancel(reason),
    consume() {
      if (consumed) {
        throw new TypeError('Streaming multipart body can only be consumed once.');
      }

      consumed = true;
      return parser.createPartStream();
    },
    mode: 'streaming',
  };
}
