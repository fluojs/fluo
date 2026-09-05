import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

interface NodeListenRetryOptions {
  readonly host: string | undefined;
  readonly port: number;
  readonly retryDelayMs: number;
  readonly retryLimit: number;
}

type NodeServer = HttpServer | HttpsServer;

class NodeListenCancelledError extends Error {
  readonly name = 'NodeListenCancelledError';

  constructor() {
    super('Node HTTP adapter startup was cancelled during shutdown.');
  }
}

/** Owns one Node server's listen, retry cancellation, and close admission state. */
export class NodeListenLifecycle {
  private closeInFlight?: Promise<void>;
  private closing = false;
  private listenAbortController?: AbortController;
  private listenInFlight?: Promise<void>;

  constructor(
    private readonly server: NodeServer,
    private readonly options: NodeListenRetryOptions,
  ) {}

  close(closeServer: () => Promise<void>): Promise<void> {
    if (this.closeInFlight) {
      return this.closeInFlight;
    }

    this.closing = true;
    const closeInFlight = (async () => {
      await this.cancel();
      await closeServer();
    })().finally(() => {
      if (this.closeInFlight === closeInFlight) {
        this.closeInFlight = undefined;
        this.closing = false;
      }
    });
    this.closeInFlight = closeInFlight;

    return closeInFlight;
  }

  listen(onAdmitted: () => void): Promise<void> {
    if (this.closing) {
      return Promise.reject(new NodeListenCancelledError());
    }

    if (this.listenInFlight) {
      return this.listenInFlight;
    }

    onAdmitted();
    const abortController = new AbortController();
    this.listenAbortController = abortController;
    const listenInFlight = listenNodeServerWithRetry(
      this.server,
      this.options,
      abortController.signal,
    ).finally(() => {
      if (this.listenInFlight === listenInFlight) {
        this.listenInFlight = undefined;
      }

      if (this.listenAbortController === abortController) {
        this.listenAbortController = undefined;
      }
    });
    this.listenInFlight = listenInFlight;

    return listenInFlight;
  }

  async cancel(): Promise<void> {
    const listenInFlight = this.listenInFlight;
    if (!listenInFlight) {
      return;
    }

    this.listenAbortController?.abort();

    try {
      await listenInFlight;
    } catch (error: unknown) {
      if (error instanceof NodeListenCancelledError) {
        return;
      }

      throw error;
    }
  }
}

function listenNodeServerWithRetry(
  server: NodeServer,
  options: NodeListenRetryOptions,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let activeErrorListener: ((error: NodeJS.ErrnoException) => void) | undefined;
    let activeListeningListener: (() => void) | undefined;
    let attemptInFlight = false;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (activeErrorListener) {
        server.off('error', activeErrorListener);
      }
      if (activeListeningListener) {
        server.off('listening', activeListeningListener);
      }
      signal.removeEventListener('abort', onAbort);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const cancel = () => {
      finish(new NodeListenCancelledError());
    };

    const onAbort = () => {
      if (attemptInFlight) {
        return;
      }

      cancel();
    };

    const tryListen = (attempt: number) => {
      if (signal.aborted) {
        cancel();
        return;
      }

      attemptInFlight = true;
      const onError = (error: NodeJS.ErrnoException) => {
        attemptInFlight = false;
        activeErrorListener = undefined;
        server.off('listening', onListening);
        activeListeningListener = undefined;

        if (signal.aborted) {
          cancel();
          return;
        }

        if (error.code === 'EADDRINUSE' && attempt < options.retryLimit) {
          server.close(() => {
            if (settled) {
              return;
            }
            if (signal.aborted) {
              cancel();
              return;
            }

            retryTimeout = setTimeout(() => {
              retryTimeout = undefined;
              tryListen(attempt + 1);
            }, options.retryDelayMs);
          });
          return;
        }

        finish(error);
      };

      const onListening = () => {
        attemptInFlight = false;
        activeListeningListener = undefined;
        server.off('error', onError);
        activeErrorListener = undefined;

        if (signal.aborted) {
          server.close(cancel);
          return;
        }

        finish();
      };

      activeErrorListener = onError;
      activeListeningListener = onListening;
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: options.host, port: options.port });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    tryListen(0);
  });
}
