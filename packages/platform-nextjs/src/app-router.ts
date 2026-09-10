import {
  createLazyNextAdapterResolver,
  type NextAdapterLoader,
} from './lazy-adapter.js';

/** Next-compatible Web request callback owned by the App Router bridge. */
export type NextAppRouteHandler = (request: Request) => Promise<Response>;

/** Method-keyed handler exports consumed by one App Router route module. */
export interface NextAppRouterMethodHandlers {
  /** Lazy handler for Next.js `DELETE` exports. */
  readonly DELETE: NextAppRouteHandler;
  /** Lazy handler for Next.js `GET` exports. */
  readonly GET: NextAppRouteHandler;
  /** Lazy handler for Next.js `HEAD` exports. */
  readonly HEAD: NextAppRouteHandler;
  /** Lazy handler for Next.js `OPTIONS` exports. */
  readonly OPTIONS: NextAppRouteHandler;
  /** Lazy handler for Next.js `PATCH` exports. */
  readonly PATCH: NextAppRouteHandler;
  /** Lazy handler for Next.js `POST` exports. */
  readonly POST: NextAppRouteHandler;
  /** Lazy handler for Next.js `PUT` exports. */
  readonly PUT: NextAppRouteHandler;
}

/**
 * Create App Router method exports that lazily import a bootstrapped adapter.
 *
 * @param loadAdapter Dynamic backend module loader.
 * @returns Method-keyed callbacks sharing one closure-local loader promise,
 * ready for destructuring into named route module exports.
 */
export function createNextAppRouterHandler(
  loadAdapter: NextAdapterLoader,
): NextAppRouterMethodHandlers {
  const resolveAdapter = createLazyNextAdapterResolver(loadAdapter);
  const handler: NextAppRouteHandler = async (request) => {
    const adapter = await resolveAdapter();
    return adapter.fetch(request);
  };

  return {
    DELETE: handler,
    GET: handler,
    HEAD: handler,
    OPTIONS: handler,
    PATCH: handler,
    POST: handler,
    PUT: handler,
  };
}
