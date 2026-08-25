import {
  createUnsupportedHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import {
  createWebRequestResponseFactory,
  dispatchWebRequest,
} from '@fluojs/runtime/web';

import {
  createLazyNextAdapterResolver,
  type NextAdapterLoader,
} from './lazy-adapter.js';

const NOT_READY_PROBLEM = {
  code: 'next_backend_adapter_not_ready',
  status: 503,
  title: 'Next backend adapter is not ready',
  type: 'https://fluo.dev/problems/next-backend-adapter-not-ready',
} as const;
const SHUTDOWN_PROBLEM = {
  code: 'next_backend_adapter_closed',
  status: 503,
  title: 'Next backend adapter is closed',
  type: 'https://fluo.dev/problems/next-backend-adapter-closed',
} as const;

/** Adapter-owned Web request parsing options. */
export interface NextAdapterOptions {
  readonly maxBodySize?: number;
  readonly rawBody?: boolean;
}

/** Bound Next-compatible Web request handler. */
export type NextAppRouteHandler = (request: Request) => Promise<Response>;

/** Invalid Next adapter setup option. */
export class InvalidNextAdapterOptionError extends Error {
  /**
   * Create an invalid-option error.
   *
   * @param message Precise option failure.
   */
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNextAdapterOptionError';
  }
}

function validateMaxBodySize(maxBodySize: number | undefined): void {
  if (maxBodySize === undefined) {
    return;
  }

  if (!Number.isSafeInteger(maxBodySize) || maxBodySize < 0) {
    throw new InvalidNextAdapterOptionError(
      'Next backend adapter maxBodySize must be a non-negative safe integer.',
    );
  }
}

function createProblemResponse(problem: typeof NOT_READY_PROBLEM | typeof SHUTDOWN_PROBLEM) {
  return Response.json(problem, {
    headers: { 'content-type': 'application/problem+json' },
    status: problem.status,
  });
}

/**
 * Web-standard Fluo HTTP adapter hosted by a Next.js Route Handler.
 */
export class NextHttpApplicationAdapter implements HttpApplicationAdapter {
  private closed = false;
  private dispatcher?: Dispatcher;
  private readonly requestResponseFactory;

  /**
   * Create a Next-hosted Fluo adapter.
   *
   * @param options Web request parsing options.
   */
  constructor(options: NextAdapterOptions = {}) {
    validateMaxBodySize(options.maxBodySize);
    this.requestResponseFactory = createWebRequestResponseFactory({
      maxBodySize: options.maxBodySize,
      rawBody: options.rawBody,
    });
  }

  /**
   * Stop accepting requests and release the bound dispatcher.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.dispatcher = undefined;
  }

  /**
   * Dispatch one Next.js Web request through Fluo.
   *
   * @param request Native Web request created by Next.js.
   * @returns Native Web response produced by the Fluo dispatcher.
   */
  readonly fetch: NextAppRouteHandler = async (request) => {
    if (this.closed) {
      return createProblemResponse(SHUTDOWN_PROBLEM);
    }
    if (!this.dispatcher) {
      return createProblemResponse(NOT_READY_PROBLEM);
    }

    return dispatchWebRequest({
      dispatcher: this.dispatcher,
      dispatcherNotReadyMessage: NOT_READY_PROBLEM.title,
      factory: this.requestResponseFactory,
      request,
    });
  };

  /** Bound handler for Next.js `DELETE` exports. */
  readonly DELETE = this.fetch;
  /** Bound handler for Next.js `GET` exports. */
  readonly GET = this.fetch;
  /** Bound handler for Next.js `HEAD` exports. */
  readonly HEAD = this.fetch;
  /** Bound handler for Next.js `OPTIONS` exports. */
  readonly OPTIONS = this.fetch;
  /** Bound handler for Next.js `PATCH` exports. */
  readonly PATCH = this.fetch;
  /** Bound handler for Next.js `POST` exports. */
  readonly POST = this.fetch;
  /** Bound handler for Next.js `PUT` exports. */
  readonly PUT = this.fetch;

  /**
   * Declare that App Router handlers do not own raw WebSocket upgrades.
   *
   * @returns Unsupported realtime capability metadata.
   */
  getRealtimeCapability() {
    return createUnsupportedHttpAdapterRealtimeCapability(
      'Next.js Route Handlers do not expose a raw WebSocket upgrade seam.',
    );
  }

  /**
   * Bind the Fluo dispatcher to the Next-hosted adapter.
   *
   * @param dispatcher Dispatcher produced during Fluo bootstrap.
   */
  async listen(dispatcher: Dispatcher): Promise<void> {
    this.closed = false;
    this.dispatcher = dispatcher;
  }
}

/**
 * Create a Next-hosted Fluo HTTP adapter.
 *
 * @param options Web request parsing options.
 * @returns A new adapter instance.
 */
export function createNextAdapter(
  options: NextAdapterOptions = {},
): NextHttpApplicationAdapter {
  return new NextHttpApplicationAdapter(options);
}

/**
 * Create one App Router handler that lazily imports a bootstrapped adapter.
 *
 * @param loadAdapter Dynamic backend module loader.
 * @returns A handler shared by every supported App Router method.
 */
export function createNextAppRouterHandler(
  loadAdapter: NextAdapterLoader,
): NextAppRouteHandler {
  const resolveAdapter = createLazyNextAdapterResolver(loadAdapter);

  return async (request) => {
    const adapter = await resolveAdapter();
    return adapter.fetch(request);
  };
}

export type { NextAdapterLoader } from './lazy-adapter.js';
