import { type FrameworkRequest, type FrameworkResponseStream, RequestAbortedError } from '@fluojs/http';

type StreamStop = 'aborted' | 'closed';

type StreamStopWait = {
  readonly cleanup: () => void;
  readonly promise: Promise<StreamStop>;
};

type ResponseCloseObserver = {
  readonly cleanup: () => void;
  readonly isClosed: () => boolean;
  readonly promise: Promise<'closed'> | undefined;
};

/** Minimal request abort surface used while React Web Streams are read. */
export type ReactAbortSource = Pick<FrameworkRequest, 'isAborted' | 'signal'>;

function createAbortWait(signal: AbortSignal | undefined): StreamStopWait | undefined {
  if (!signal) {
    return undefined;
  }

  if (signal.aborted) {
    return { cleanup: () => undefined, promise: Promise.resolve('aborted') };
  }

  let listener: (() => void) | undefined;
  const promise = new Promise<'aborted'>((resolve) => {
    listener = () => resolve('aborted');
    signal.addEventListener('abort', listener, { once: true });
  });

  return {
    cleanup: () => {
      if (listener) {
        signal.removeEventListener('abort', listener);
      }
    },
    promise,
  };
}

function createResponseCloseObserver(target: FrameworkResponseStream): ResponseCloseObserver {
  let closeObserved = target.closed;
  let removeListener: (() => void) | undefined;
  const promise = closeObserved
    ? Promise.resolve<'closed'>('closed')
    : target.onClose
      ? new Promise<'closed'>((resolve) => {
        removeListener = target.onClose?.(() => {
          closeObserved = true;
          resolve('closed');
        }) ?? undefined;
      })
      : undefined;

  return {
    cleanup: () => {
      removeListener?.();
      removeListener = undefined;
    },
    isClosed: () => closeObserved || target.closed,
    promise,
  };
}

function isReactRequestAborted(source: ReactAbortSource): boolean {
  return source.isAborted?.() === true || source.signal?.aborted === true;
}

/**
 * Throws when a request has been aborted through either supported HTTP abort surface.
 *
 * @param source Request abort source exposed by the active fluo request.
 */
export function throwIfReactRequestAborted(source: ReactAbortSource): void {
  if (isReactRequestAborted(source)) {
    throw new RequestAbortedError();
  }
}

async function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSource: ReactAbortSource,
): Promise<ReadableStreamReadResult<Uint8Array> | 'aborted'>;
async function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSource: ReactAbortSource,
  responseClose: ResponseCloseObserver,
): Promise<ReadableStreamReadResult<Uint8Array> | StreamStop>;
async function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSource: ReactAbortSource,
  responseClose?: ResponseCloseObserver,
): Promise<ReadableStreamReadResult<Uint8Array> | StreamStop> {
  if (isReactRequestAborted(abortSource)) {
    return 'aborted';
  }

  if (responseClose?.isClosed()) {
    return 'closed';
  }

  const stops: Promise<StreamStop>[] = [];
  const abort = createAbortWait(abortSource.signal);

  if (abort) {
    stops.push(abort.promise);
  }

  if (responseClose?.promise) {
    stops.push(responseClose.promise);
  }

  if (stops.length === 0) {
    const next = await reader.read();
    if (isReactRequestAborted(abortSource)) {
      return 'aborted';
    }
    return responseClose?.isClosed() ? 'closed' : next;
  }

  try {
    const next = await Promise.race([reader.read(), ...stops]);
    if (next === 'aborted' || isReactRequestAborted(abortSource)) {
      return 'aborted';
    }
    if (next === 'closed' || responseClose?.isClosed()) {
      return 'closed';
    }
    return next;
  } finally {
    abort?.cleanup();
  }
}

/**
 * Collects a React HTML stream for buffered hosts without committing partial bodies after abort.
 *
 * @param stream React Web Stream to collect.
 * @param abortSource Request abort source checked before buffered response metadata is applied.
 * @returns Fully collected HTML bytes.
 */
export async function collectReadableStream(
  stream: ReadableStream<Uint8Array>,
  abortSource: ReactAbortSource,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (!isReactRequestAborted(abortSource)) {
      const next = await readNextChunk(reader, abortSource);

      if (next === 'aborted') {
        await reader.cancel();
        throw new RequestAbortedError();
      }

      if (next.done) {
        break;
      }

      chunks.push(next.value);
      byteLength += next.value.byteLength;
    }

    if (isReactRequestAborted(abortSource)) {
      await reader.cancel();
      throw new RequestAbortedError();
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

/**
 * Pipes a React HTML stream into an already committed streaming response until close or abort.
 *
 * @param stream React Web Stream to pipe.
 * @param target Response stream that receives HTML chunks.
 * @param abortSource Request abort source checked between chunks.
 * @returns A promise that resolves when piping stops and the target is closed.
 */
export async function pipeReadableStream(
  stream: ReadableStream<Uint8Array>,
  target: FrameworkResponseStream,
  abortSource: ReactAbortSource,
): Promise<void> {
  const reader = stream.getReader();
  let responseClose: ResponseCloseObserver | undefined;
  let cancelPromise: Promise<void> | undefined;
  let sourceCompleted = false;
  let stopped = false;
  const cancelReaderOnce = (): Promise<void> => {
    cancelPromise ??= reader.cancel();
    return cancelPromise;
  };

  try {
    responseClose = createResponseCloseObserver(target);

    while (!isReactRequestAborted(abortSource) && !responseClose.isClosed()) {
      const next = await readNextChunk(reader, abortSource, responseClose);

      if (next === 'aborted' || next === 'closed') {
        stopped = true;
        break;
      }

      if (next.done) {
        sourceCompleted = true;
        break;
      }

      try {
        const accepted = target.write(next.value);

        if (responseClose.isClosed()) {
          stopped = true;
          break;
        }

        if (!accepted) {
          const drain = target.waitForDrain?.();
          if (drain) {
            await (responseClose.promise ? Promise.race([drain, responseClose.promise]) : drain);
          }

          if (responseClose.isClosed()) {
            stopped = true;
            break;
          }
        }
      } catch (error) {
        await Promise.allSettled([cancelReaderOnce()]);
        throw error;
      }
    }

    if (!sourceCompleted && (stopped || isReactRequestAborted(abortSource) || responseClose.isClosed())) {
      await cancelReaderOnce();
    }
  } finally {
    responseClose?.cleanup();
    reader.releaseLock();

    if (!target.closed) {
      target.close();
    }
  }
}
