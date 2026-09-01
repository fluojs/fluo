import type { Constructor, MaybePromise, MetadataPropertyKey, MetadataSource, Token } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';
import type { ErrorResponse, HttpException } from './exceptions.js';

export type { ValidationIssue, Validator } from '@fluojs/validation';

/** Canonical uppercase HTTP method token or Fluo's reserved `ALL` wildcard sentinel. */
export type HttpMethod = string;

/** Strategies that decide how versioned HTTP routes are selected for one request. */
export enum VersioningType {
  URI = 'URI',
  HEADER = 'HEADER',
  MEDIA_TYPE = 'MEDIA_TYPE',
  CUSTOM = 'CUSTOM',
}

/**
 * Adapter-normalized incoming request passed through the HTTP pipeline.
 *
 * Runtime adapters populate this shape so decorators, binders, guards, and
 * middleware can reason about one stable contract instead of platform-specific
 * request objects.
 */
export interface FrameworkRequest {
  method: HttpMethod | string;
  path: string;
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  query: Readonly<Record<string, string | string[] | undefined>>;
  cookies: Readonly<Record<string, string | undefined>>;
  params: Readonly<Record<string, string>>;
  body?: unknown;
  /** Adapter-provided multipart files exposed through the runtime-neutral request seam. */
  files?: readonly FrameworkRequestFile[];
  /** Adapter-snapshotted inbound request id used without forcing header normalization. */
  requestId?: string;
  /**
   * Adapter-snapshotted transport metadata available without platform-specific
   * casts from middleware, guards, and request-scoped services.
   */
  connection?: FrameworkRequestConnection;
  rawBody?: Uint8Array;
  raw: unknown;
  /** Adapter-owned abort probe used by internal fast paths without forcing AbortSignal allocation. */
  isAborted?: () => boolean;
  signal?: AbortSignal;
}

/**
 * Runtime-neutral transport metadata captured when an adapter receives a request.
 *
 * @remarks
 * Fetch-only adapters may omit this value because the Web `Request` contract
 * does not expose a peer address.
 */
export interface FrameworkRequestConnection {
  /** Direct peer address supplied by the adapter transport, when available. */
  readonly remoteAddress?: string;
  /** Transport protocol supplied by the adapter when known. */
  readonly protocol?: 'http' | 'https';
}

/** Runtime-neutral multipart file shape attached by adapters that parse uploads. */
export interface FrameworkRequestFile {
  /** Multipart form field name that carried this file. */
  fieldname: string;
  /** Client-provided original filename. */
  originalname: string;
  /** Media type reported for the uploaded file. */
  mimetype: string;
  /** Buffered file bytes. */
  buffer: Uint8Array;
  /** File size in bytes. */
  size: number;
}

/**
 * Adapter-normalized mutable response facade shared across dispatch stages.
 *
 * Dispatch policies write headers, status, redirects, and bodies through this
 * contract before the underlying platform commits the response.
 */
export interface FrameworkResponse {
  compression?: FrameworkResponseCompression;
  /**
   * Optional request-scoped writer for HTTP 103 informational responses.
   *
   * @remarks Property absence means the active adapter cannot emit Early Hints.
   */
  earlyHints?: FrameworkResponseEarlyHints;
  statusCode?: number;
  statusSet?: boolean;
  headers: Record<string, string | string[]>;
  committed: boolean;
  raw?: unknown;
  stream?: FrameworkResponseStream;
  setStatus(code: number): void;
  /**
   * Writes one response header value.
   *
   * Repeated `Set-Cookie` writes append ordered independent fields. Other
   * header names retain adapter-defined replacement semantics.
   */
  setHeader(name: string, value: string | string[]): void;
  redirect(status: number, location: string): void;
  send(body: unknown): MaybePromise<void>;
}

/**
 * Headers accepted by one HTTP 103 Early Hints write.
 *
 * @remarks
 * Node-backed transports require at least one non-empty `link` value. Additional
 * informational header fields must use valid HTTP names and values. Header names
 * are case-insensitive and cannot be repeated with different casing.
 */
export type EarlyHintsHeaders = Readonly<Record<string, string | readonly string[]>> & {
  readonly link: string | readonly string[];
};

/** Optional request-scoped capability for writing HTTP 103 Early Hints. */
export interface FrameworkResponseEarlyHints {
  /**
   * Emit one informational response without committing or mutating the final response.
   *
   * @param headers Link hints and optional additional informational fields.
   * @returns A promise that settles when the native transport accepts the write.
   */
  write(headers: EarlyHintsHeaders): Promise<void>;
}

/** Compression writer used when a platform can stream encoded response bodies. */
export interface FrameworkResponseCompression {
  write(
    body: Uint8Array,
    options?: FrameworkResponseCompressionWriteOptions,
  ): MaybePromise<boolean>;
}

/** Additional metadata passed to a response compression writer. */
export interface FrameworkResponseCompressionWriteOptions {
  contentType?: string;
}

/**
 * Low-level streaming handle used by SSE and other incremental response flows.
 */
export interface FrameworkResponseStream {
  readonly closed: boolean;
  close(): void;
  flush?(): void;
  onClose?(listener: () => void): (() => void) | void;
  waitForDrain?(): Promise<void>;
  write(chunk: string | Uint8Array): boolean;
}

/** Serializer used during response content negotiation. */
export interface ResponseFormatter {
  readonly mediaType: string;
  format(body: unknown): string | Uint8Array;
}

/** Response negotiation settings applied to one route or dispatcher instance. */
export interface ContentNegotiationOptions {
  defaultMediaType?: string;
  formatters?: ResponseFormatter[];
}

/**
 * HTTP-classified failure data passed to an application HTML representation provider.
 *
 * @remarks
 * The context intentionally omits `FrameworkResponse`. Providers may resolve
 * request-scoped dependencies, but status, headers, body suppression, and
 * response commit remain owned by the HTTP dispatcher.
 */
export interface HttpErrorRepresentationContext {
  /** Request-scoped dependency container active for the failed dispatch. */
  readonly container: RequestScopeContainer;
  /** HTTP exception selected by dispatcher error classification. */
  readonly error: HttpException;
  /** Matched handler when the failure happened after route matching. */
  readonly handler?: HandlerDescriptor;
  /** Canonical JSON envelope for the selected HTTP outcome. */
  readonly json: ErrorResponse;
  /** Adapter-normalized request that produced the failure. */
  readonly request: FrameworkRequest;
  /** Optional request identifier preserved from the active request context. */
  readonly requestId?: string;
}

/** Application-owned renderer for optional HTML error and not-found documents. */
export interface HtmlErrorRepresentationProvider {
  /**
   * Decides whether HTML is available for one classified HTTP outcome.
   *
   * @param context HTTP-owned error outcome and request-scope access.
   * @returns `true` when this provider can render the outcome; defaults to `true` when omitted.
   */
  canRender?(context: HttpErrorRepresentationContext): MaybePromise<boolean>;
  /**
   * Renders a complete HTML document before the dispatcher commits the response.
   *
   * @param context HTTP-owned error outcome and request-scope access.
   * @returns Runtime-neutral UTF-8 text or bytes for the HTML representation.
   */
  render(context: HttpErrorRepresentationContext): MaybePromise<string | Uint8Array>;
}

/** Optional error representation providers registered for one HTTP application. */
export interface HttpErrorRepresentationOptions {
  /** Application-owned HTML provider; canonical JSON remains framework-owned and always available. */
  readonly html: HtmlErrorRepresentationProvider;
}

/** Authenticated caller identity attached to the active request context. */
export interface Principal {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
}

/**
 * Per-request execution context shared across binding, guards, interceptors,
 * and controller handlers.
 */
export interface RequestContext {
  request: FrameworkRequest;
  response: FrameworkResponse;
  requestId?: string;
  principal?: Principal;
  metadata: Record<string | symbol, unknown>;
  container: RequestScopeContainer;
}

/** Typed metadata key used to store request-scoped values safely. */
export interface ContextKey<T> {
  readonly id: symbol;
  readonly description: string;
  readonly __type?: T;
}

/** Controller method signature after DTO binding and request-context injection. */
export type ControllerHandler<Input = unknown, Result = unknown> = (
  input: Input,
  ctx: RequestContext,
) => MaybePromise<Result>;

/**
 * Route-level behavioral metadata collected from HTTP decorators.
 */
export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  produces?: string[];
  request?: Constructor;
  guards?: GuardLike[];
  headers?: { name: string; value: string }[];
  interceptors?: InterceptorLike[];
  redirect?: { url: string; statusCode?: number };
  successStatus?: number;
  version?: string;
}

/** Derived metadata used while mapping controllers into dispatchable handlers. */
export interface HandlerMetadata {
  controllerPath: string;
  effectivePath: string;
  effectiveVersion?: string;
  moduleMiddleware: MiddlewareLike[];
  moduleType?: Constructor;
  pathParams: string[];
}

/** Fully resolved controller handler descriptor stored in handler mappings. */
export interface HandlerDescriptor {
  controllerToken: Constructor;
  metadata: HandlerMetadata;
  methodName: string;
  route: RouteDefinition;
}

/** Result returned when request matching resolves one handler and path params. */
export interface HandlerMatch {
  descriptor: HandlerDescriptor;
  params: Readonly<Record<string, string>>;
}

/** Immutable lookup table that matches incoming requests to controller handlers. */
export interface HandlerMapping {
  readonly descriptors: HandlerDescriptor[];

  match(request: FrameworkRequest): HandlerMatch | undefined;
}

/** Source module/controller pair used to build a handler mapping. */
export interface HandlerSource {
  controllerToken: Constructor;
  moduleMiddleware?: MiddlewareLike[];
  moduleType?: Constructor;
}

/** Candidate version values returned by a custom version extractor. */
export type VersioningExtractorResult = string | readonly string[] | undefined;
/** Callback that extracts route version candidates from one framework request. */
export type VersioningExtractor = (request: FrameworkRequest) => VersioningExtractorResult;

/**
 * Versioning configuration shared by dispatcher and route-mapping policies.
 */
export type VersioningOptions =
  | {
      type?: VersioningType.URI;
    }
  | {
      type: VersioningType.HEADER;
      header: string;
    }
  | {
      type: VersioningType.MEDIA_TYPE;
      key?: string;
    }
  | {
      type: VersioningType.CUSTOM;
      extractor: VersioningExtractor;
    };

/** Runtime dispatcher that executes the full HTTP request lifecycle. */
export interface Dispatcher {
  dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void>;
  /**
   * Executes a pre-matched native route through the fast path when safe.
   *
   * @internal Platform adapters may use this to avoid duplicate dispatcher
   * scaffolding for routes already selected by their native router. It returns
   * `false` when the route must fall back to the normal dispatch lifecycle.
   */
  dispatchNativeRoute?(match: HandlerMatch, request: FrameworkRequest, response: FrameworkResponse): Promise<boolean>;
  /**
   * Returns the mapped route descriptors known to this dispatcher when the
   * implementation can expose them without changing dispatch behavior.
   */
  describeRoutes?(): readonly HandlerDescriptor[];
}

/** Logger seam used by the dispatcher for non-fatal internal failure reporting. */
export interface DispatcherLogger {
  error(message: string, error?: unknown, context?: string): void;
}

/** Observation payload delivered to request observers throughout one dispatch. */
export interface RequestObservationContext {
  handler?: HandlerDescriptor;
  requestContext: RequestContext;
}

/** Continuation callback that advances middleware or interceptor execution. */
export type Next = () => Promise<void>;

/** Input passed to one middleware invocation. */
export interface MiddlewareContext {
  request: FrameworkRequest;
  requestContext: RequestContext;
  response: FrameworkResponse;
}

/** Request pipeline middleware contract. */
export interface Middleware {
  handle(context: MiddlewareContext, next: Next): MaybePromise<void>;
}

/** Declarative middleware binding for selected route patterns. */
export interface MiddlewareRouteConfig {
  middleware: Constructor<Middleware>;
  routes: string[];
}

/** Guard execution context for one matched handler invocation. */
export interface GuardContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

/** Authorization or precondition contract evaluated before handler execution. */
export interface Guard {
  canActivate(context: GuardContext): MaybePromise<void | boolean>;
}

/** Lazy handle that lets interceptors continue into the next execution stage. */
export interface CallHandler {
  handle(): Promise<unknown>;
}

/** Interceptor execution context for one matched handler. */
export interface InterceptorContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

/** Around-invocation hook for transforming handler input, output, or errors. */
export interface Interceptor {
  intercept(context: InterceptorContext, next: CallHandler): MaybePromise<unknown>;
}

/** Lifecycle observer notified as one request moves through dispatch stages. */
export interface RequestObserver {
  onHandlerMatched?(context: RequestObservationContext): MaybePromise<void>;
  onRequestError?(context: RequestObservationContext, error: unknown): MaybePromise<void>;
  onRequestFinish?(context: RequestObservationContext): MaybePromise<void>;
  onRequestStart?(context: RequestObservationContext): MaybePromise<void>;
  onRequestSuccess?(context: RequestObservationContext, value: unknown): MaybePromise<void>;
}

/** Context passed to DTO binders while resolving handler arguments. */
export interface ArgumentResolverContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

/** Converter reference accepted by binding decorators and binder configuration. */
export type ConverterLike = Converter | Token<Converter>;

/** DTO property target metadata supplied to a converter invocation. */
export interface ConverterTarget {
  dto: Constructor;
  handler: HandlerDescriptor;
  key: string;
  propertyKey: MetadataPropertyKey;
  requestContext: RequestContext;
  source: MetadataSource;
}

/** DTO binder that materializes one handler input object from request data. */
export interface Binder {
  bind(dto: Constructor, context: ArgumentResolverContext): MaybePromise<unknown>;
}

/** Value converter used to coerce one bound request field into a target shape. */
export interface Converter {
  convert(value: unknown, target: ConverterTarget): MaybePromise<unknown>;
}

/** Middleware reference accepted by module/runtime configuration. */
export type MiddlewareLike = Middleware | Token<Middleware> | MiddlewareRouteConfig;
/** Guard reference accepted by route metadata and runtime configuration. */
export type GuardLike = Guard | Token<Guard>;
/** Interceptor reference accepted by route metadata and runtime configuration. */
export type InterceptorLike = Interceptor | Token<Interceptor>;
/** Request observer reference accepted by runtime configuration. */
export type RequestObserverLike = RequestObserver | Token<RequestObserver>;
