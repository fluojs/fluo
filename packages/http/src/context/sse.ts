import type { FrameworkResponse, FrameworkResponseStream, RequestContext } from '../types.js';

/** Options that customize the fields emitted for one server-sent event frame. */
export interface SseSendOptions {
  /** Optional SSE event name. Newline characters are stripped before writing. */
  event?: string;
  /** Optional SSE event id. Newline characters are stripped before writing. */
  id?: string | number;
  /** Optional client retry delay in milliseconds. Non-finite or negative values are ignored. */
  retry?: number;
}

function sanitizeSseField(value: string): string {
  return value.replace(/\r/g, '').replace(/\n/g, '');
}

function splitSseLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function toSseDataString(data: unknown): string {
  if (data === undefined) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  const serialized = JSON.stringify(data);

  if (serialized === undefined) {
    throw new TypeError(`SseResponse data must be JSON-serializable. Received ${typeof data}.`);
  }

  return serialized;
}

function resolveSseStream(response: FrameworkResponse): FrameworkResponseStream {
  if (!response.stream) {
    throw new Error('SseResponse requires adapter-provided response.stream support.');
  }

  return response.stream;
}

/**
 * Encodes a comment as a canonical server-sent event comment frame.
 *
 * @param comment Comment text to split into SSE comment lines.
 * @returns A complete SSE comment frame ending in a blank line.
 */
export function encodeSseComment(comment: string): string {
  const lines = splitSseLines(comment);
  const encoded = lines.map((line) => (line.length === 0 ? ':' : `: ${line}`));

  return `${encoded.join('\n')}\n\n`;
}

/**
 * Encodes data and optional event fields as a server-sent event message frame.
 *
 * @param data Payload to write. Strings are sent as-is; other values are JSON serialized.
 * @param options Optional event metadata fields.
 * @returns A complete SSE message frame ending in a blank line.
 * @throws {TypeError} When `data` cannot be represented as an SSE data field.
 */
export function encodeSseMessage(data: unknown, options: SseSendOptions = {}): string {
  const lines: string[] = [];

  if (options.event !== undefined) {
    lines.push(`event: ${sanitizeSseField(options.event)}`);
  }

  if (options.id !== undefined) {
    lines.push(`id: ${sanitizeSseField(String(options.id))}`);
  }

  if (options.retry !== undefined && Number.isFinite(options.retry) && options.retry >= 0) {
    lines.push(`retry: ${String(Math.floor(options.retry))}`);
  }

  for (const line of splitSseLines(toSseDataString(data))) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join('\n')}\n\n`;
}

/**
 * Response helper for server-sent event streams backed by an adapter-provided response stream.
 *
 * The helper commits SSE headers immediately, closes idempotently on request abort
 * or raw stream close, and removes all registered close/abort listeners during cleanup.
 */
export class SseResponse {
  private closed = false;
  private readonly stream: FrameworkResponseStream;
  private removeCloseListener?: () => void;

  private readonly onAbort = (): void => {
    this.close();
  };

  constructor(private readonly context: RequestContext) {
    this.stream = resolveSseStream(context.response);

    if (context.response.statusSet !== true) {
      context.response.setStatus(200);
    }

    context.response.setHeader('Cache-Control', 'no-cache, no-transform');
    context.response.setHeader('Connection', 'keep-alive');
    context.response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    context.response.setHeader('X-Accel-Buffering', 'no');
    context.response.committed = true;
    this.stream.flush?.();

    if (context.request.signal?.aborted) {
      this.close();
      return;
    }

    context.request.signal?.addEventListener('abort', this.onAbort, { once: true });

    const removeCloseListener = this.stream.onClose?.(this.onAbort) ?? undefined;

    if (this.closed) {
      removeCloseListener?.();
      return;
    }

    this.removeCloseListener = removeCloseListener;
  }

  /**
   * Writes one SSE data message when the stream is still open.
   *
   * @param data Payload to encode into `data:` lines.
   * @param options Optional event metadata fields.
   * @returns `true` when the underlying stream accepted the frame without backpressure.
   */
  send(data: unknown, options: SseSendOptions = {}): boolean {
    return this.writeFrame(encodeSseMessage(data, options));
  }

  /**
   * Writes one SSE comment frame when the stream is still open.
   *
   * @param comment Comment text to encode.
   * @returns `true` when the underlying stream accepted the frame without backpressure.
   */
  comment(comment: string): boolean {
    return this.writeFrame(encodeSseComment(comment));
  }

  /** Closes the SSE stream and removes registered abort/close listeners exactly once. */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.context.request.signal?.removeEventListener('abort', this.onAbort);
    this.removeCloseListener?.();
    this.removeCloseListener = undefined;

    if (!this.stream.closed) {
      this.stream.close();
    }

    this.context.response.committed = true;
  }

  private writeFrame(frame: string): boolean {
    if (this.closed) {
      return false;
    }

    if (this.stream.closed) {
      this.close();
      return false;
    }

    return this.stream.write(frame);
  }
}
