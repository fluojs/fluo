const TEST_DEADLINE_MS = 1_000;
const MAX_SUBSCRIPTION_PAYLOAD_BYTES = 64 * 1024;

export function parseSubscriptionData(frame: string): string {
  const dataLines: string[] = [];

  for (const line of frame.split(/\r\n|\n/)) {
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);

    if (field !== 'data') {
      continue;
    }

    const value = colon < 0 ? '' : line.slice(colon + 1);
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
  }

  if (dataLines.length === 0) {
    throw new Error('Expected a data field in the GraphQL subscription frame.');
  }

  return dataLines.join('\n');
}

export function parseSubscriptionFrame(frame: string): unknown {
  return JSON.parse(parseSubscriptionData(frame));
}

export async function readSubscriptionPayload(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(TEST_DEADLINE_MS);
  const timedOut = new Promise<never>((_, reject) => {
    timeout.addEventListener(
      'abort',
      () => reject(new Error('Timed out waiting for the GraphQL subscription payload.')),
      { once: true },
    );
  });
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const boundary = /\r?\n\r?\n/.exec(buffer);

    if (boundary) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);

      if (
        frame
          .split(/\r\n|\n/)
          .some((line) => line === 'data' || line.startsWith('data:'))
      ) {
        return parseSubscriptionFrame(frame);
      }
      continue;
    }

    const chunk = await Promise.race([reader.read(), timedOut]);

    if (chunk.done) {
      throw new Error('Expected a GraphQL subscription payload before the stream closed.');
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    if (buffer.length > MAX_SUBSCRIPTION_PAYLOAD_BYTES) {
      throw new Error('Expected the GraphQL subscription payload to fit within 64 KiB.');
    }
  }
}

export async function waitWithin<T>(promise: Promise<T>, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), TEST_DEADLINE_MS);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function fetchWithin(input: string, init: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(TEST_DEADLINE_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return await fetch(input, { ...init, signal });
}
