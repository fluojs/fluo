import type { HttpErrorRepresentationOptions, Middleware, RequestObserver } from '@fluojs/http';
import type { ModuleType } from '@fluojs/runtime';
import {
  assertProviderlessHeadResponse,
  assertRepresentationResponses,
  createErrorRepresentationOptions,
  createProviderlessErrorRepresentationOptions,
  createRepresentationFixture,
} from './error-representation-portability-fixture.js';

type NetworkApp = {
  close(): Promise<void>;
  listen(): Promise<void>;
};

type NetworkHarnessOptions<TBootstrapOptions extends object, TApp extends NetworkApp> = {
  readonly bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  readonly createBootstrapOptions: (
    options: NetworkHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;
  readonly name: string;
};

type WebApp = {
  close(): Promise<void>;
  dispatch(request: Request): Promise<Response>;
};

type WebHarnessOptions<TBootstrapOptions extends object, TApp extends WebApp> = {
  readonly bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  readonly createBootstrapOptions: (
    options: WebHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;
  readonly name: string;
};

/** Adapter bootstrap fields required by the network error-representation portability scenario. */
export type NetworkHttpErrorRepresentationBootstrapOptions = {
  readonly cors: false;
  readonly errorRepresentation: HttpErrorRepresentationOptions | undefined;
  readonly middleware: Middleware[];
  readonly observers: RequestObserver[];
  readonly port: 0;
};

/** Adapter bootstrap fields required by the Web error-representation portability scenario. */
export type WebHttpErrorRepresentationBootstrapOptions = {
  readonly cors: false;
  readonly errorRepresentation: HttpErrorRepresentationOptions | undefined;
  readonly middleware: Middleware[];
};

type ListenTarget = { readonly url: string };
type AdapterWithListenTarget = { getListenTarget(): ListenTarget };

function hasListenTarget(value: unknown): value is AdapterWithListenTarget {
  return typeof value === 'object'
    && value !== null
    && 'getListenTarget' in value
    && typeof value.getListenTarget === 'function';
}

function resolveListeningUrl(app: NetworkApp, name: string): string {
  const adapter: unknown = Reflect.get(app, 'adapter');
  if (!hasListenTarget(adapter)) {
    throw new Error(`${name} error representation portability check could not resolve its listener URL.`);
  }
  return adapter.getListenTarget().url;
}

async function closeAfterAssertion(app: NetworkApp | WebApp, name: string, assertion: () => Promise<void>): Promise<void> {
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
      : new AggregateError([assertionError, cleanupError], `${name} representation assertion and cleanup both failed.`);
  }

  if (assertionError !== undefined) {
    throw assertionError;
  }
}

/**
 * Verifies negotiated HTTP error representations through a listening adapter.
 *
 * @param options Adapter bootstrap and identity callbacks.
 * @returns A promise that resolves after JSON, HTML, HEAD, 406, and commit-guard checks pass.
 */
export async function assertNetworkHttpErrorRepresentationPortability<
  TBootstrapOptions extends object,
  TApp extends NetworkApp,
>(options: NetworkHarnessOptions<TBootstrapOptions, TApp>): Promise<void> {
  const app = await options.bootstrap(
    createRepresentationFixture(),
    options.createBootstrapOptions({
      ...createErrorRepresentationOptions(),
      observers: [],
      port: 0,
    }),
  );

  await closeAfterAssertion(app, options.name, async () => {
    await app.listen();
    const baseUrl = resolveListeningUrl(app, options.name);
    await assertRepresentationResponses(options.name, {
      committed: await fetch(`${baseUrl}/error-representations/committed`, { headers: { accept: 'text/html' } }),
      head: await fetch(`${baseUrl}/error-representations/head`, { headers: { accept: 'text/html' }, method: 'HEAD' }),
      html: await fetch(`${baseUrl}/not-registered`, { headers: { accept: 'text/html' } }),
      json: await fetch(`${baseUrl}/error-representations/json`, { headers: { accept: 'application/json' } }),
      jsonHead: await fetch(`${baseUrl}/error-representations/head`, { headers: { accept: 'application/json' }, method: 'HEAD' }),
      successHead: await fetch(`${baseUrl}/error-representations/success-head`, { method: 'HEAD' }),
      unsupported: await fetch(`${baseUrl}/not-registered`, { headers: { accept: 'image/avif' } }),
      unsupportedHead: await fetch(`${baseUrl}/not-registered`, { headers: { accept: 'image/avif' }, method: 'HEAD' }),
    });
  });

  const providerlessApp = await options.bootstrap(
    createRepresentationFixture(),
    options.createBootstrapOptions({
      ...createProviderlessErrorRepresentationOptions(),
      observers: [],
      port: 0,
    }),
  );

  await closeAfterAssertion(providerlessApp, options.name, async () => {
    await providerlessApp.listen();
    const baseUrl = resolveListeningUrl(providerlessApp, options.name);
    await assertProviderlessHeadResponse(
      options.name,
      await fetch(`${baseUrl}/not-registered`, { method: 'HEAD' }),
    );
  });
}

/**
 * Verifies negotiated HTTP error representations through a fetch-style adapter.
 *
 * @param options Adapter bootstrap and identity callbacks.
 * @returns A promise that resolves after JSON, HTML, HEAD, 406, and commit-guard checks pass.
 */
export async function assertWebHttpErrorRepresentationPortability<
  TBootstrapOptions extends object,
  TApp extends WebApp,
>(options: WebHarnessOptions<TBootstrapOptions, TApp>): Promise<void> {
  const app = await options.bootstrap(
    createRepresentationFixture(),
    options.createBootstrapOptions(createErrorRepresentationOptions()),
  );

  await closeAfterAssertion(app, options.name, async () => {
    const request = (path: string, accept: string, method = 'GET') => new Request(`https://runtime.test${path}`, {
      headers: { accept },
      method,
    });
    await assertRepresentationResponses(options.name, {
      committed: await app.dispatch(request('/error-representations/committed', 'text/html')),
      head: await app.dispatch(request('/error-representations/head', 'text/html', 'HEAD')),
      html: await app.dispatch(request('/not-registered', 'text/html')),
      json: await app.dispatch(request('/error-representations/json', 'application/json')),
      jsonHead: await app.dispatch(request('/error-representations/head', 'application/json', 'HEAD')),
      successHead: await app.dispatch(request('/error-representations/success-head', '*/*', 'HEAD')),
      unsupported: await app.dispatch(request('/not-registered', 'image/avif')),
      unsupportedHead: await app.dispatch(request('/not-registered', 'image/avif', 'HEAD')),
    });
  });

  const providerlessApp = await options.bootstrap(
    createRepresentationFixture(),
    options.createBootstrapOptions(createProviderlessErrorRepresentationOptions()),
  );

  await closeAfterAssertion(providerlessApp, options.name, async () => {
    await assertProviderlessHeadResponse(
      options.name,
      await providerlessApp.dispatch(new Request('https://runtime.test/not-registered', { method: 'HEAD' })),
    );
  });
}
