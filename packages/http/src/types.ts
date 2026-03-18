import type { Constructor, MaybePromise, MetadataPropertyKey, MetadataSource, Token } from '@konekti/core';
import type { RequestScopeContainer } from '@konekti/di';
export type { ValidationIssue, Validator } from '@konekti/dto-validator';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface FrameworkRequest {
  method: HttpMethod | string;
  path: string;
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  query: Readonly<Record<string, string | string[] | undefined>>;
  cookies: Readonly<Record<string, string | undefined>>;
  params: Readonly<Record<string, string>>;
  body?: unknown;
  rawBody?: Uint8Array;
  raw: unknown;
  signal?: AbortSignal;
}

export interface FrameworkResponse {
  statusCode?: number;
  statusSet?: boolean;
  headers: Record<string, string>;
  committed: boolean;
  setStatus(code: number): void;
  setHeader(name: string, value: string): void;
  redirect(status: number, location: string): void;
  send(body: unknown): MaybePromise<void>;
}

export interface Principal {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
}

export interface RequestContext {
  request: FrameworkRequest;
  response: FrameworkResponse;
  requestId?: string;
  principal?: Principal;
  metadata: Record<string, unknown>;
  container: RequestScopeContainer;
}

export type ControllerHandler<Input = unknown, Result = unknown> = (
  input: Input,
  ctx: RequestContext,
) => MaybePromise<Result>;

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  request?: Constructor;
  guards?: GuardLike[];
  interceptors?: InterceptorLike[];
  successStatus?: number;
  version?: string;
}

export interface HandlerMetadata {
  controllerPath: string;
  effectivePath: string;
  effectiveVersion?: string;
  moduleMiddleware: MiddlewareLike[];
  moduleType?: Constructor;
  pathParams: string[];
}

export interface HandlerDescriptor {
  controllerToken: Constructor;
  metadata: HandlerMetadata;
  methodName: string;
  route: RouteDefinition;
}

export interface HandlerMatch {
  descriptor: HandlerDescriptor;
  params: Readonly<Record<string, string>>;
}

export interface HandlerMapping {
  readonly descriptors: HandlerDescriptor[];

  match(request: FrameworkRequest): HandlerMatch | undefined;
}

export interface HandlerSource {
  controllerToken: Constructor;
  moduleMiddleware?: MiddlewareLike[];
  moduleType?: Constructor;
}

export interface Dispatcher {
  dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void>;
}

export interface RequestObservationContext {
  handler?: HandlerDescriptor;
  requestContext: RequestContext;
}

export type Next = () => Promise<void>;

export interface MiddlewareContext {
  request: FrameworkRequest;
  requestContext: RequestContext;
  response: FrameworkResponse;
}

export interface Middleware {
  handle(context: MiddlewareContext, next: Next): MaybePromise<void>;
}

export interface MiddlewareRouteConfig {
  middleware: Constructor<Middleware>;
  routes: string[];
}

export interface GuardContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

export interface Guard {
  canActivate(context: GuardContext): MaybePromise<void | boolean>;
}

export interface CallHandler {
  handle(): Promise<unknown>;
}

export interface InterceptorContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

export interface Interceptor {
  intercept(context: InterceptorContext, next: CallHandler): MaybePromise<unknown>;
}

export interface RequestObserver {
  onHandlerMatched?(context: RequestObservationContext): MaybePromise<void>;
  onRequestError?(context: RequestObservationContext, error: unknown): MaybePromise<void>;
  onRequestFinish?(context: RequestObservationContext): MaybePromise<void>;
  onRequestStart?(context: RequestObservationContext): MaybePromise<void>;
  onRequestSuccess?(context: RequestObservationContext, value: unknown): MaybePromise<void>;
}

export interface ArgumentResolverContext {
  handler: HandlerDescriptor;
  requestContext: RequestContext;
}

export interface ConverterTarget {
  dto: Constructor;
  propertyKey: MetadataPropertyKey;
  source: MetadataSource;
}

export interface Binder {
  bind(dto: Constructor, context: ArgumentResolverContext): MaybePromise<unknown>;
}

export interface Converter {
  convert(value: unknown, target: ConverterTarget): MaybePromise<unknown>;
}

export type MiddlewareLike = Middleware | Token<Middleware> | MiddlewareRouteConfig;
export type GuardLike = Guard | Token<Guard>;
export type InterceptorLike = Interceptor | Token<Interceptor>;
export type RequestObserverLike = RequestObserver | Token<RequestObserver>;
