import {
  type BodyParser,
  createUnsupportedHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import {
  createWebRequestResponseFactory,
  dispatchWebRequest,
  startWebRequestDispatch,
} from '@fluojs/runtime/web';

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

/** Adapter-owned Web request parsing and opt-in HEAD routing options. */
export interface NextAdapterOptions {
  /**
   * Bounded non-multipart parser, before HTTP middleware/guards. Omission keeps
   * MIME-based parsing; text preserves the original Content-Type without JSON
   * interpretation. Pages Router still requires Next's `bodyParser: false`.
   */
  readonly bodyParser?: BodyParser;
  /**
   * Select explicit HEAD, then ALL, then GET without changing the request method.
   * Omit to preserve ordinary routing. Opted-in HEAD responses are bodyless and
   * active streams are cancelled before request lifecycle completion is awaited.
   */
  readonly headRouting?: 'explicit-or-get';
  readonly maxBodySize?: number;
  readonly rawBody?: boolean;
}

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

function createProblemResponse(
  problem: typeof NOT_READY_PROBLEM | typeof SHUTDOWN_PROBLEM,
  bodyless = false,
) {
  return new Response(bodyless ? null : JSON.stringify(problem), {
    headers: { 'content-type': 'application/problem+json' },
    status: problem.status,
  });
}

/**
 * Web-standard Fluo HTTP adapter hosted by a Next.js Route Handler.
 */
export class NextHttpApplicationAdapter implements HttpApplicationAdapter {
  /**
   * Create an independently owned Next-hosted adapter for `FluoFactory.create()`.
   *
   * @param options Web request parsing and opt-in HEAD routing options.
   * @returns A new, unbound adapter instance.
   * @throws InvalidNextAdapterOptionError When maxBodySize is not a non-negative safe integer.
   */
  static create(options: NextAdapterOptions = {}): NextHttpApplicationAdapter {
    return new NextHttpApplicationAdapter(options);
  }

  private closed = false;
  private dispatcher?: Dispatcher;
  private readonly headRouting;
  private readonly requestResponseFactory;

  /**
   * Create a Next-hosted Fluo adapter.
   *
   * @param options Web request parsing and opt-in HEAD routing options.
   */
  constructor(options: NextAdapterOptions = {}) {
    validateMaxBodySize(options.maxBodySize);
    const headRouting = options.headRouting;
    this.headRouting = headRouting;
    const factory = createWebRequestResponseFactory({
      bodyParser: options.bodyParser,
      consumeOriginalBody: true,
      maxBodySize: options.maxBodySize,
      rawBody: options.rawBody,
    });
    this.requestResponseFactory = {
      ...factory,
      async createRequest(request: Request, signal: AbortSignal) {
        const normalized = await factory.createRequest(request, signal);
        return Object.assign(normalized, { headRouting });
      },
    };
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
  readonly fetch = async (request: Request): Promise<Response> => {
    const isHead = request.method === 'HEAD' && this.headRouting === 'explicit-or-get';
    if (this.closed) {
      return createProblemResponse(SHUTDOWN_PROBLEM, isHead);
    }
    if (!this.dispatcher) {
      return createProblemResponse(NOT_READY_PROBLEM, isHead);
    }

    if (isHead) {
      const dispatch = startWebRequestDispatch({
        dispatcher: this.dispatcher,
        factory: this.requestResponseFactory,
        request,
      });
      try {
        const response = await dispatch.response;
        await response.body?.cancel();
        return new Response(null, response);
      } finally {
        await dispatch.completion;
      }
    }

    return dispatchWebRequest({
      dispatcher: this.dispatcher,
      dispatcherNotReadyMessage: NOT_READY_PROBLEM.title,
      factory: this.requestResponseFactory,
      request,
    });
  };

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
