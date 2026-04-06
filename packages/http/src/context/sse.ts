import type { FrameworkResponse, FrameworkResponseStream, RequestContext } from '../types.js';

export interface SseSendOptions {
  event?: string;
  id?: string | number;
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

export function encodeSseComment(comment: string): string {
  const lines = splitSseLines(comment);
  const encoded = lines.map((line) => (line.length === 0 ? ':' : `: ${line}`));

  return `${encoded.join('\n')}\n\n`;
}

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

    if (context.request.signal === undefined) {
      this.removeCloseListener = this.stream.onClose?.(this.onAbort) ?? undefined;
    }
  }

  send(data: unknown, options: SseSendOptions = {}): boolean {
    return this.writeFrame(encodeSseMessage(data, options));
  }

  comment(comment: string): boolean {
    return this.writeFrame(encodeSseComment(comment));
  }

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
