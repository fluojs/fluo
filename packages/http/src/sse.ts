import type { FrameworkResponse, RequestContext } from './types.js';

export interface SseSendOptions {
  event?: string;
  id?: string | number;
  retry?: number;
}

interface WritableSseStream {
  flushHeaders?: () => void;
  writableEnded: boolean;
  write(chunk: string): boolean;
  end(): void;
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

  return serialized ?? '';
}

function isWritableSseStream(value: unknown): value is WritableSseStream {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    end?: unknown;
    flushHeaders?: unknown;
    writableEnded?: unknown;
    write?: unknown;
  };

  return typeof candidate.writableEnded === 'boolean'
    && typeof candidate.write === 'function'
    && typeof candidate.end === 'function'
    && (candidate.flushHeaders === undefined || typeof candidate.flushHeaders === 'function');
}

function resolveSseStream(response: FrameworkResponse): WritableSseStream {
  const rawResponse = response.raw;

  if (!isWritableSseStream(rawResponse)) {
    throw new Error('SseResponse requires a writable adapter response stream.');
  }

  return rawResponse;
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
  private readonly stream: WritableSseStream;

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
    this.stream.flushHeaders?.();

    if (context.request.signal?.aborted) {
      this.close();
      return;
    }

    context.request.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  send(data: unknown, options: SseSendOptions = {}): void {
    this.writeFrame(encodeSseMessage(data, options));
  }

  comment(comment: string): void {
    this.writeFrame(encodeSseComment(comment));
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.context.request.signal?.removeEventListener('abort', this.onAbort);

    if (!this.stream.writableEnded) {
      this.stream.end();
    }

    this.context.response.committed = true;
  }

  private writeFrame(frame: string): void {
    if (this.closed) {
      return;
    }

    if (this.stream.writableEnded) {
      this.close();
      return;
    }

    this.stream.write(frame);
  }
}
