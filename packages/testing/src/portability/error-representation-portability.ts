import {
  Controller,
  Get,
  Head,
  type HttpErrorRepresentationOptions,
  type Middleware,
  NotFoundException,
  type RequestContext,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

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
  readonly errorRepresentation: HttpErrorRepresentationOptions;
  readonly middleware: Middleware[];
  readonly port: 0;
};

/** Adapter bootstrap fields required by the Web error-representation portability scenario. */
export type WebHttpErrorRepresentationBootstrapOptions = {
  readonly cors: false;
  readonly errorRepresentation: HttpErrorRepresentationOptions;
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

function hasErrorCode(value: unknown, code: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const error: unknown = Reflect.get(value, 'error');
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === code;
}

function assertStatus(response: Response, expected: number, name: string, scenario: string): void {
  if (response.status !== expected) {
    throw new Error(`${name} changed ${scenario} status: expected ${String(expected)}, received ${String(response.status)}.`);
  }
}

async function assertRepresentationResponses(
  name: string,
  responses: {
    readonly committed: Response;
    readonly head: Response;
    readonly html: Response;
    readonly json: Response;
    readonly unsupported: Response;
  },
): Promise<void> {
  assertStatus(responses.html, 404, name, 'HTML error representation');
  assertStatus(responses.json, 404, name, 'JSON error representation');
  assertStatus(responses.head, 404, name, 'HEAD error representation');
  assertStatus(responses.unsupported, 406, name, 'unsupported error representation');
  assertStatus(responses.committed, 202, name, 'already-committed response');

  const [html, json, head, unsupported, committed] = await Promise.all([
    responses.html.text(),
    responses.json.json(),
    responses.head.text(),
    responses.unsupported.json(),
    responses.committed.text(),
  ]);

  if (!responses.html.headers.get('content-type')?.includes('text/html') || !html.includes('404:NOT_FOUND')) {
    throw new Error(`${name} changed negotiated HTML error representation semantics.`);
  }
  if (!hasErrorCode(json, 'NOT_FOUND')) {
    throw new Error(`${name} changed canonical JSON error representation semantics.`);
  }
  if (!responses.head.headers.get('content-type')?.includes('text/html') || head !== '') {
    throw new Error(`${name} changed HEAD error representation body suppression.`);
  }
  if (!hasErrorCode(unsupported, 'NOT_ACCEPTABLE')) {
    throw new Error(`${name} changed unsupported error representation fallback semantics.`);
  }
  if (committed !== 'handler-owned') {
    throw new Error(`${name} rewrote an already-committed response through the error provider.`);
  }
}

function createRepresentationFixture(): ModuleType {
  @Controller('/error-representations')
  class ErrorRepresentationController {
    @Get('/json')
    json(): never {
      throw new NotFoundException('Matched resource missing.');
    }

    @Head('/head')
    head(): never {
      throw new NotFoundException('HEAD resource missing.');
    }

    @Get('/committed')
    async committed(_input: undefined, context: RequestContext): Promise<never> {
      context.response.setStatus(202);
      await context.response.send('handler-owned');
      throw new NotFoundException('Committed response must not be replaced.');
    }
  }

  class AppModule {}
  defineModule(AppModule, { controllers: [ErrorRepresentationController] });
  return AppModule;
}

function createErrorRepresentationOptions(): WebHttpErrorRepresentationBootstrapOptions {
  return {
    cors: false,
    errorRepresentation: {
      html: {
        render({ json }: { readonly json: { readonly error: { readonly code: string; readonly status: number } } }) {
          return `<html><body>${String(json.error.status)}:${json.error.code}</body></html>`;
        },
      },
    },
    middleware: [],
  };
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
    options.createBootstrapOptions({ ...createErrorRepresentationOptions(), port: 0 }),
  );

  await closeAfterAssertion(app, options.name, async () => {
    await app.listen();
    const baseUrl = resolveListeningUrl(app, options.name);
    await assertRepresentationResponses(options.name, {
      committed: await fetch(`${baseUrl}/error-representations/committed`, { headers: { accept: 'text/html' } }),
      head: await fetch(`${baseUrl}/error-representations/head`, { headers: { accept: 'text/html' }, method: 'HEAD' }),
      html: await fetch(`${baseUrl}/not-registered`, { headers: { accept: 'text/html' } }),
      json: await fetch(`${baseUrl}/error-representations/json`, { headers: { accept: 'application/json' } }),
      unsupported: await fetch(`${baseUrl}/not-registered`, { headers: { accept: 'image/avif' } }),
    });
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
      unsupported: await app.dispatch(request('/not-registered', 'image/avif')),
    });
  });
}
