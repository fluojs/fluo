import { InvariantError, type Token } from '@konekti/core';
import type { Container } from '@konekti/di';

import { HandlerNotFoundError, RequestAbortedError } from './errors.js';
import { HttpException, InternalServerException, NotAcceptableException, NotFoundException, createErrorResponse } from './exceptions.js';
import { DefaultBinder } from './binding.js';
import { HttpDtoValidationAdapter } from './dto-validation-adapter.js';
import { runGuardChain } from './guards.js';
import { runInterceptorChain } from './interceptors.js';
import { runMiddlewareChain } from './middleware.js';
import { createRequestContext, runWithRequestContext } from './request-context.js';
import { SseResponse } from './sse.js';
import type {
  ArgumentResolverContext,
  Dispatcher,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  HandlerDescriptor,
  HandlerMapping,
  InterceptorContext,
  MiddlewareLike,
  ResponseFormatter,
  ContentNegotiationOptions,
  RequestObserver,
  RequestObserverLike,
  RequestObservationContext,
  RequestContext,
} from './types.js';

const defaultBinder = new DefaultBinder();
const defaultValidator = new HttpDtoValidationAdapter();

export type ErrorHandler = (error: unknown, request: FrameworkRequest, response: FrameworkResponse, requestId?: string) => Promise<boolean | void> | boolean | void;

export interface CreateDispatcherOptions {
  appMiddleware?: MiddlewareLike[];
  contentNegotiation?: ContentNegotiationOptions;
  handlerMapping: HandlerMapping;
  observers?: RequestObserverLike[];
  onError?: ErrorHandler;
  rootContainer: Container;
}

interface AcceptToken {
  mediaRange: string;
  quality: number;
  specificity: number;
}

interface ResolvedContentNegotiation {
  defaultFormatter: ResponseFormatter;
  formatters: ResponseFormatter[];
}

function normalizeMediaType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function readAcceptHeader(request: FrameworkRequest): string | undefined {
  const raw = request.headers.accept ?? request.headers.Accept;
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function parseQuality(value: string | undefined): number {
  if (!value) {
    return 1;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  if (parsed > 1) {
    return 1;
  }

  return parsed;
}

function getMediaRangeSpecificity(mediaRange: string): number {
  if (mediaRange === '*/*') {
    return 0;
  }

  if (mediaRange.endsWith('/*')) {
    return 1;
  }

  return 2;
}

function parseAcceptHeader(acceptHeader: string): AcceptToken[] {
  const tokens: AcceptToken[] = [];

  for (const token of acceptHeader.split(',')) {
    const [rawMediaRange, ...parameterParts] = token.trim().split(';');
    const mediaRange = normalizeMediaType(rawMediaRange ?? '');

    if (!mediaRange || !mediaRange.includes('/')) {
      continue;
    }

    let quality = 1;

    for (const parameterPart of parameterParts) {
      const [name, value] = parameterPart.trim().split('=');

      if (name?.toLowerCase() === 'q') {
        quality = parseQuality(value?.trim());
        break;
      }
    }

    if (quality <= 0) {
      continue;
    }

    tokens.push({
      mediaRange,
      quality,
      specificity: getMediaRangeSpecificity(mediaRange),
    });
  }

  return tokens.sort((left, right) => {
    if (right.quality !== left.quality) {
      return right.quality - left.quality;
    }

    return right.specificity - left.specificity;
  });
}

function matchesMediaRange(mediaRange: string, mediaType: string): boolean {
  if (mediaRange === '*/*') {
    return true;
  }

  const [rangeType, rangeSubtype] = mediaRange.split('/');
  const [mediaTypeType, mediaTypeSubtype] = mediaType.split('/');

  if (!rangeType || !rangeSubtype || !mediaTypeType || !mediaTypeSubtype) {
    return false;
  }

  if (rangeType !== '*' && rangeType !== mediaTypeType) {
    return false;
  }

  return rangeSubtype === '*' || rangeSubtype === mediaTypeSubtype;
}

function resolveContentNegotiation(options: ContentNegotiationOptions | undefined): ResolvedContentNegotiation | undefined {
  if (!options?.formatters?.length) {
    return undefined;
  }

  const formatters = options.formatters.filter((formatter, index, all) => {
    const mediaType = normalizeMediaType(formatter.mediaType);

    if (!mediaType) {
      return false;
    }

    return all.findIndex((item) => normalizeMediaType(item.mediaType) === mediaType) === index;
  });

  if (!formatters.length) {
    return undefined;
  }

  const defaultMediaType = normalizeMediaType(options.defaultMediaType ?? '');
  const defaultFormatter = defaultMediaType
    ? formatters.find((formatter) => normalizeMediaType(formatter.mediaType) === defaultMediaType) ?? formatters[0]
    : formatters[0];

  return {
    defaultFormatter,
    formatters,
  };
}

function resolveAllowedFormatters(
  handler: HandlerDescriptor,
  contentNegotiation: ResolvedContentNegotiation,
): ResponseFormatter[] {
  if (!handler.route.produces?.length) {
    return contentNegotiation.formatters;
  }

  const allowed = new Set(handler.route.produces.map((mediaType) => normalizeMediaType(mediaType)));
  return contentNegotiation.formatters.filter((formatter) => allowed.has(normalizeMediaType(formatter.mediaType)));
}

function resolveDefaultFormatter(
  allowedFormatters: ResponseFormatter[],
  contentNegotiation: ResolvedContentNegotiation,
): ResponseFormatter {
  const defaultMediaType = normalizeMediaType(contentNegotiation.defaultFormatter.mediaType);

  return allowedFormatters.find((formatter) => normalizeMediaType(formatter.mediaType) === defaultMediaType)
    ?? allowedFormatters[0]
    ?? contentNegotiation.defaultFormatter;
}

function selectResponseFormatter(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  contentNegotiation: ResolvedContentNegotiation,
): ResponseFormatter {
  const allowedFormatters = resolveAllowedFormatters(handler, contentNegotiation);

  if (!allowedFormatters.length) {
    throw new NotAcceptableException('No acceptable response representation found.');
  }

  const defaultFormatter = resolveDefaultFormatter(allowedFormatters, contentNegotiation);
  const acceptHeader = readAcceptHeader(request);

  if (!acceptHeader) {
    return defaultFormatter;
  }

  const acceptTokens = parseAcceptHeader(acceptHeader);

  if (!acceptTokens.length) {
    return defaultFormatter;
  }

  for (const token of acceptTokens) {
    if (token.mediaRange === '*/*') {
      return defaultFormatter;
    }

    const matchedFormatter = allowedFormatters.find((formatter) => {
      return matchesMediaRange(token.mediaRange, normalizeMediaType(formatter.mediaType));
    });

    if (matchedFormatter) {
      return matchedFormatter;
    }
  }

  throw new NotAcceptableException('No acceptable response representation found.');
}

function createDispatchRequest(request: FrameworkRequest): FrameworkRequest {
  return {
    ...request,
    params: { ...request.params },
  };
}

function readRequestId(request: FrameworkRequest): string | undefined {
  const raw = request.headers['x-request-id'] ?? request.headers['X-Request-Id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function createDispatchContext(
  request: FrameworkRequest,
  response: FrameworkResponse,
  rootContainer: Container,
): RequestContext {
  return createRequestContext({
    container: rootContainer.createRequestScope(),
    metadata: {},
    request,
    requestId: readRequestId(request),
    response,
  });
}

function updateRequestParams(context: RequestContext, params: Readonly<Record<string, string>>): void {
  context.request = {
    ...context.request,
    params,
  };
}

async function invokeControllerHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
): Promise<unknown> {
  const controller = await requestContext.container.resolve(handler.controllerToken as Token<object>);
  const method = (controller as Record<string, unknown>)[handler.methodName];

  if (typeof method !== 'function') {
    throw new InvariantError(
      `Controller ${handler.controllerToken.name} does not expose handler method ${handler.methodName}.`,
    );
  }

  const argumentResolverContext: ArgumentResolverContext = {
    handler,
    requestContext,
  };
  const input = handler.route.request
    ? await defaultBinder.bind(handler.route.request, argumentResolverContext)
    : undefined;

  if (handler.route.request) {
    await defaultValidator.validate(input, handler.route.request);
  }

  return method.call(controller, input, requestContext);
}

function resolveDefaultSuccessStatus(handler: HandlerDescriptor, value: unknown): number {
  switch (handler.route.method) {
    case 'POST':
      return 201;
    case 'DELETE':
    case 'OPTIONS':
      return value === undefined ? 204 : 200;
    default:
      return 200;
  }
}

async function writeSuccessResponse(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  contentNegotiation: ResolvedContentNegotiation | undefined,
): Promise<void> {
  if (response.committed) {
    return;
  }

  const formatter = contentNegotiation
    ? selectResponseFormatter(handler, request, contentNegotiation)
    : undefined;

  if (formatter) {
    response.setHeader('Content-Type', formatter.mediaType);
  }

  if (handler.route.successStatus !== undefined) {
    response.setStatus(handler.route.successStatus);
  } else if (response.statusSet !== true) {
    response.setStatus(resolveDefaultSuccessStatus(handler, value));
  }

  const responseBody = formatter
    ? formatter.format(value)
    : value;
  await response.send(responseBody);
}

function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof HandlerNotFoundError) {
    return new NotFoundException(error.message, { cause: error });
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}

async function writeErrorResponse(error: unknown, response: FrameworkResponse, requestId?: string): Promise<void> {
  if (response.committed) {
    return;
  }

  const httpError = toHttpException(error);
  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
}

function isRequestObserver(value: RequestObserverLike): value is RequestObserver {
  return typeof value === 'object' && value !== null;
}

async function resolveRequestObserver(
  definition: RequestObserverLike,
  requestContext: RequestContext,
): Promise<RequestObserver> {
  if (isRequestObserver(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<RequestObserver>);
}

async function notifyObservers(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  handler?: HandlerDescriptor,
): Promise<void> {
  const context: RequestObservationContext = {
    handler,
    requestContext,
  };

  for (const definition of observers) {
    const observer = await resolveRequestObserver(definition, requestContext);
    await callback(observer, context);
  }
}

async function dispatchMatchedHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  observers: RequestObserverLike[],
  contentNegotiation: ResolvedContentNegotiation | undefined,
): Promise<void> {
  const guardContext: GuardContext = {
    handler,
    requestContext,
  };
  const interceptorContext: InterceptorContext = {
    handler,
    requestContext,
  };

  await runGuardChain(handler.route.guards ?? [], guardContext);

  if (requestContext.response.committed) {
    return;
  }

  const result = await runInterceptorChain(handler.route.interceptors ?? [], interceptorContext, async () => {
    return invokeControllerHandler(handler, requestContext);
  });

  ensureRequestNotAborted(requestContext.request);

  if (!(result instanceof SseResponse) && !requestContext.response.committed) {
    await writeSuccessResponse(handler, requestContext.request, requestContext.response, result, contentNegotiation);
  }

  try {
    await notifyObservers(
      observers,
      requestContext,
      async (observer, context) => {
        await observer.onRequestSuccess?.(context, result);
      },
      handler,
    );
  } catch {
    // Observer errors must not mask a successful request.
  }
}

export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const requestContext = createDispatchContext(createDispatchRequest(request), response, options.rootContainer);
      const observers = options.observers ?? [];

      await runWithRequestContext(requestContext, async () => {
        await notifyObservers(observers, requestContext, async (observer, context) => {
          await observer.onRequestStart?.(context);
        });

        try {
          ensureRequestNotAborted(requestContext.request);
          await runMiddlewareChain(options.appMiddleware ?? [], {
            request: requestContext.request,
            requestContext,
            response,
          }, async () => {
            if (response.committed) {
              return;
            }

            const match = options.handlerMapping.match(requestContext.request);

            if (!match) {
              throw new HandlerNotFoundError(`No handler registered for ${request.method} ${request.path}.`);
            }

            updateRequestParams(requestContext, match.params);
            await notifyObservers(
              observers,
              requestContext,
              async (observer, context) => {
                await observer.onHandlerMatched?.(context);
              },
              match.descriptor,
            );

            await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], {
              request: requestContext.request,
              requestContext,
              response,
            }, async () => {
              await dispatchMatchedHandler(match.descriptor, requestContext, observers, contentNegotiation);
            });
          });
        } catch (error: unknown) {
          if (error instanceof RequestAbortedError || requestContext.request.signal?.aborted) {
            return;
          }

          try {
            await notifyObservers(
              observers,
              requestContext,
              async (observer, context) => {
                await observer.onRequestError?.(context, error);
              },
            );
          } catch {
            // Observer errors must not mask the original request error.
          }

          const handled = await options.onError?.(error, requestContext.request, response, requestContext.requestId);

          if (handled) {
            return;
          }

          await writeErrorResponse(error, response, requestContext.requestId);
        } finally {
          try {
            await notifyObservers(observers, requestContext, async (observer, context) => {
              await observer.onRequestFinish?.(context);
            });
          } catch {
            // Observer errors in the finally block must not mask earlier errors.
          }
        }
      });
    },
  };
}
