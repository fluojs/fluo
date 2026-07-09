import { RequestAbortedError, type FrameworkRequest, type FrameworkResponseStream } from '@fluojs/http';

type AbortWait = {
  readonly cleanup: () => void;
  readonly promise: Promise<'aborted'>;
};

/** Minimal request abort surface used while React Web Streams are read. */
export type ReactAbortSource = Pick<FrameworkRequest, 'isAborted' | 'signal'>;

function createAbortWait(signal: AbortSignal | undefined): AbortWait | undefined {
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
): Promise<ReadableStreamReadResult<Uint8Array> | 'aborted'> {
  if (isReactRequestAborted(abortSource)) {
    return 'aborted';
  }

  const abort = createAbortWait(abortSource.signal);

  if (!abort) {
    const next = await reader.read();
    return isReactRequestAborted(abortSource) ? 'aborted' : next;
  }

  try {
    const next = await Promise.race([reader.read(), abort.promise]);
    return next === 'aborted' || isReactRequestAborted(abortSource) ? 'aborted' : next;
  } finally {
    abort.cleanup();
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

  try {
    while (!isReactRequestAborted(abortSource) && !target.closed) {
      const next = await readNextChunk(reader, abortSource);

      if (next === 'aborted') {
        break;
      }

      if (next.done) {
        break;
      }

      const accepted = target.write(next.value);

      if (!accepted) {
        await target.waitForDrain?.();
      }
    }

    if (isReactRequestAborted(abortSource)) {
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();

    if (!target.closed) {
      target.close();
    }
  }
}
