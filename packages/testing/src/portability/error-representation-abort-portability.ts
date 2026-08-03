import type {
  HtmlErrorRepresentationProvider,
  Middleware,
  RequestObserver,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import type {
  NetworkHttpErrorRepresentationBootstrapOptions,
  WebHttpErrorRepresentationBootstrapOptions,
} from './error-representation-portability.js';

type NetworkApp = {
  close(): Promise<void>;
  listen(): Promise<void>;
};

type WebApp = {
  close(): Promise<void>;
  dispatch(request: Request): Promise<Response>;
};

type NetworkHarnessOptions<TBootstrapOptions extends object, TApp extends NetworkApp> = {
  readonly bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  readonly createBootstrapOptions: (
    options: NetworkHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;
  readonly name: string;
};

type WebHarnessOptions<TBootstrapOptions extends object, TApp extends WebApp> = {
  readonly bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  readonly createBootstrapOptions: (
    options: WebHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;
  readonly name: string;
};

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

type AbortProbe = {
  readonly bootstrapOptions: WebHttpErrorRepresentationBootstrapOptions;
  readonly providerAborted: Promise<void>;
  readonly providerStarted: Promise<void>;
  readonly requestFinished: Promise<void>;
  readonly requestObserver: RequestObserver;
  assertNoCommit(name: string): void;
};

type ListenTarget = { readonly url: string };
type AdapterWithListenTarget = { getListenTarget(): ListenTarget };

function createDeferred(): Deferred {
  let resolve = (): void => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createAbortProbe(): AbortProbe {
  const providerAborted = createDeferred();
  const providerStarted = createDeferred();
  const requestFinished = createDeferred();
  let providerCalls = 0;
  const representationWrites: unknown[] = [];
  const middleware: Middleware = {
    async handle(context, next) {
      const send = context.response.send.bind(context.response);
      context.response.send = (body: unknown) => {
        if (body !== undefined) {
          representationWrites.push(body);
        }
        return send(body);
      };

      await next();
    },
  };
  const requestObserver: RequestObserver = {
    onRequestFinish() {
      requestFinished.resolve();
    },
  };
  const html: HtmlErrorRepresentationProvider = {
    render({ request }) {
      providerCalls += 1;
      providerStarted.resolve();

      return new Promise<string>((resolve, reject) => {
        const signal = request.signal;
        if (signal === undefined) {
          reject(new Error('The adapter did not expose an AbortSignal to the HTML error provider.'));
          return;
        }

        const completeAfterAbort = (): void => {
          providerAborted.resolve();
          resolve('<html><body>late error document</body></html>');
        };

        if (signal.aborted) {
          completeAfterAbort();
          return;
        }

        signal.addEventListener('abort', completeAfterAbort, { once: true });
      });
    },
  };

  return {
    assertNoCommit(name) {
      if (providerCalls !== 1) {
        throw new Error(`${name} did not execute exactly one in-flight HTML error provider before abort.`);
      }
      if (representationWrites.length !== 0) {
        throw new Error(
          `${name} committed an HTML or canonical JSON fallback response after abort: ${JSON.stringify(representationWrites)}.`,
        );
      }
    },
    bootstrapOptions: {
      cors: false,
      errorRepresentation: { html },
      middleware: [middleware],
    },
    providerAborted: providerAborted.promise,
    providerStarted: providerStarted.promise,
    requestFinished: requestFinished.promise,
    requestObserver,
  };
}

function hasListenTarget(value: unknown): value is AdapterWithListenTarget {
  return typeof value === 'object'
    && value !== null
    && 'getListenTarget' in value
    && typeof value.getListenTarget === 'function';
}

function resolveListeningUrl(app: NetworkApp, name: string): string {
  const adapter: unknown = Reflect.get(app, 'adapter');
  if (!hasListenTarget(adapter)) {
    throw new Error(`${name} abort portability check could not resolve its listener URL.`);
  }
  return adapter.getListenTarget().url;
}

async function withTimeout(promise: Promise<void>, name: string, phase: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${name} timed out while waiting for ${phase}.`));
    }, 2_000);
  });

  try {
    await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function closeAfterAbortAssertion(
  app: NetworkApp | WebApp,
  name: string,
  assertion: () => Promise<void>,
): Promise<void> {
  let assertionError: unknown;
  try {
    await assertion();
  } catch (error) {
    assertionError = error;
  }

  try {
    await app.close();
  } catch (cleanupError) {
    throw assertionError === undefined
      ? cleanupError
      : new AggregateError([assertionError, cleanupError], `${name} abort assertion and cleanup both failed.`);
  }

  if (assertionError !== undefined) {
    throw assertionError;
  }
}

function createEmptyModule(): ModuleType {
  class AppModule {}
  defineModule(AppModule, {});
  return AppModule;
}

/**
 * Verifies that a disconnected network request commits neither HTML nor canonical JSON fallback.
 *
 * @param options Adapter bootstrap and identity callbacks.
 * @returns A promise that resolves after native disconnect and no-representation-write checks pass.
 */
export async function assertNetworkHttpErrorRepresentationAbortPortability<
  TBootstrapOptions extends object,
  TApp extends NetworkApp,
>(options: NetworkHarnessOptions<TBootstrapOptions, TApp>): Promise<void> {
  const probe = createAbortProbe();
  const app = await options.bootstrap(
    createEmptyModule(),
    options.createBootstrapOptions({
      ...probe.bootstrapOptions,
      observers: [probe.requestObserver],
      port: 0,
    }),
  );

  await closeAfterAbortAssertion(app, options.name, async () => {
    await app.listen();
    const { request } = await import('node:http');
    const clientRequest = request(`${resolveListeningUrl(app, options.name)}/abort-error-representation`, {
      headers: { accept: 'text/html' },
    });
    clientRequest.on('error', () => {});

    try {
      clientRequest.end();
      await withTimeout(probe.providerStarted, options.name, 'the HTML error provider to start');
      clientRequest.destroy();
      await withTimeout(probe.providerAborted, options.name, 'the provider request signal to abort');
      await withTimeout(probe.requestFinished, options.name, 'the aborted request lifecycle to finish');
      probe.assertNoCommit(options.name);
    } finally {
      clientRequest.destroy();
    }
  });
}

/**
 * Verifies that an aborted Web request commits neither HTML nor canonical JSON fallback.
 *
 * @param options Adapter bootstrap and identity callbacks.
 * @returns A promise that resolves after Web abort and no-representation-write checks pass.
 */
export async function assertWebHttpErrorRepresentationAbortPortability<
  TBootstrapOptions extends object,
  TApp extends WebApp,
>(options: WebHarnessOptions<TBootstrapOptions, TApp>): Promise<void> {
  const probe = createAbortProbe();
  const app = await options.bootstrap(
    createEmptyModule(),
    options.createBootstrapOptions(probe.bootstrapOptions),
  );

  await closeAfterAbortAssertion(app, options.name, async () => {
    const abortController = new AbortController();
    const dispatch = app.dispatch(new Request('https://runtime.test/abort-error-representation', {
      headers: { accept: 'text/html' },
      signal: abortController.signal,
    }));

    await withTimeout(probe.providerStarted, options.name, 'the HTML error provider to start');
    abortController.abort();
    await withTimeout(probe.providerAborted, options.name, 'the provider request signal to abort');
    await dispatch;
    probe.assertNoCommit(options.name);
  });
}
