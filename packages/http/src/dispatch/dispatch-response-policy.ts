import { appendVaryHeader, getRequestHeader } from '../header-helpers.js';
import type {
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
  ResponseFormatter,
  ResponseValidators,
} from '../types.js';
import {
  applyResponseValidators,
  type ConditionalRequestOutcome,
} from './conditional-request-policy.js';
import {
  type ResolvedContentNegotiation,
  resolveContentNegotiation,
  selectResponseFormatter,
} from './dispatch-content-negotiation.js';
import { writeErrorResponse } from './dispatch-error-policy.js';
import { applyRouteHeaders } from './dispatch-response-metadata.js';
import {
  createByteRangeResponse,
  isByteRangeByteSource,
  shouldApplyByteRange,
} from '../byte-range-response.js';
import {
  FRAMEWORK_RESPONSE_VALUE_FINALIZER,
  FRAMEWORK_RESPONSE_REPRESENTATION,
  FRAMEWORK_RESPONSE_WRITER,
  type FrameworkResponseRepresentation,
  type FrameworkResponseValueFinalizer,
  type FrameworkResponseWriter,
} from './response-integration.js';

type SimpleJsonResponseBody = Record<string, unknown> | unknown[];
const BINARY_CONTENT_TYPE = 'application/octet-stream';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const NAVIGATION_CONTENT_TYPE = 'application/vnd.fluo.react-navigation+json;v=2';

type SimpleJsonFrameworkResponse = FrameworkResponse & {
  sendSimpleJson(body: SimpleJsonResponseBody): ReturnType<FrameworkResponse['send']>;
};

type SuccessResponseMetadataContext = {
  readonly formatter: ResponseFormatter | undefined;
  readonly handler: HandlerDescriptor;
  readonly response: FrameworkResponse;
  readonly value: unknown;
};

/** Selected representation metadata shared by success and conditional response writers. */
export interface ResolvedResponsePolicy {
  readonly formatter: ResponseFormatter | undefined;
  readonly variesByAccept: boolean;
}

/**
 * Resolves the representation policy before conditional request evaluation.
 *
 * @param handler Matched route descriptor.
 * @param request Adapter-normalized request.
 * @param contentNegotiation Configured response formatters.
 * @returns Formatter selection and representation variance metadata.
 */
export function resolveResponsePolicy(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  contentNegotiation: ResolvedContentNegotiation | undefined,
): ResolvedResponsePolicy {
  const formatter = contentNegotiation
    ? selectResponseFormatter(handler, request, contentNegotiation)
    : undefined;

  return {
    formatter,
    variesByAccept: formatter !== undefined,
  };
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

function canUseSimpleJsonFastPath(
  response: FrameworkResponse,
  value: unknown,
): value is SimpleJsonResponseBody {
  return isSimpleJsonResponseBody(value)
    && !isResponseBodyForbidden(response.statusCode)
    && hasJsonCompatibleContentType(response);
}

function hasSimpleJsonResponseWriter(response: FrameworkResponse): response is SimpleJsonFrameworkResponse {
  return typeof (response as { sendSimpleJson?: unknown }).sendSimpleJson === 'function';
}

function isSimpleJsonResponseBody(value: unknown): value is SimpleJsonResponseBody {
  if (Array.isArray(value)) {
    return true;
  }

  return typeof value === 'object'
    && value !== null
    && Object.getPrototypeOf(value) === Object.prototype;
}

function readFrameworkResponseWriter(value: unknown): FrameworkResponseWriter | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const writer = Reflect.get(value, FRAMEWORK_RESPONSE_WRITER);

  return typeof writer === 'function' ? writer : undefined;
}

function readFrameworkResponseRepresentation(value: unknown): FrameworkResponseRepresentation | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const representation: unknown = Reflect.get(value, FRAMEWORK_RESPONSE_REPRESENTATION);
  if (typeof representation !== 'object' || representation === null) {
    return undefined;
  }
  const mediaType: unknown = Reflect.get(representation, 'mediaType');
  const body: unknown = Reflect.get(representation, 'body');
  const prefetch: unknown = Reflect.get(representation, 'prefetch');
  const method: unknown = Reflect.get(representation, 'method');
  return typeof mediaType === 'string' && typeof body === 'function'
    ? {
      mediaType,
      ...(method === 'POST' ? { method } : {}),
      body: (context) => Reflect.apply(body, representation, [context]),
      ...(prefetch === 'public' ? { prefetch } : {}),
    }
    : undefined;
}

function requestsRepresentation(request: FrameworkRequest, representation: FrameworkResponseRepresentation): boolean {
  if (request.method.toUpperCase() !== (representation.method ?? 'GET')) {
    return false;
  }
  const accept = getRequestHeader(request, 'accept');
  const values = Array.isArray(accept) ? accept : accept === undefined ? [] : [accept];
  return values.some((value) => value.trim().toLowerCase() === representation.mediaType.toLowerCase());
}

function readFrameworkResponseValueFinalizer(requestContext: RequestContext): FrameworkResponseValueFinalizer | undefined {
  const finalizer = requestContext.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER];

  if (typeof finalizer !== 'function') {
    return undefined;
  }

  return (context) => Reflect.apply(finalizer, undefined, [context]);
}

function isResponseBodyForbidden(status: number | undefined): boolean {
  return status === 204 || status === 205 || status === 304;
}

function hasJsonCompatibleContentType(response: FrameworkResponse): boolean {
  const contentType = readHeader(response.headers, 'content-type');
  return contentType === undefined || isJsonContentType(contentType);
}

function readHeader(headers: FrameworkResponse['headers'], name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName);
  const value = entry?.[1];

  return typeof value === 'string' ? value : undefined;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('application/json') || contentType.toLowerCase().endsWith('+json');
}

function applySuccessResponseMetadata(context: SuccessResponseMetadataContext): void {
  const { formatter, handler, response, value } = context;

  applyRouteHeaders(handler, response);

  if (formatter) {
    response.setHeader('Content-Type', formatter.mediaType);
  }

  if (handler.route.successStatus !== undefined) {
    response.setStatus(handler.route.successStatus);
  } else if (response.statusSet !== true) {
    response.setStatus(resolveDefaultSuccessStatus(handler, value));
  }
}

function applyImplicitHeadContentType(response: FrameworkResponse, value: unknown): void {
  if (readHeader(response.headers, 'content-type') !== undefined || value === undefined) {
    return;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    response.setHeader('Content-Type', BINARY_CONTENT_TYPE);
    return;
  }

  response.setHeader('Content-Type', typeof value === 'string' ? TEXT_CONTENT_TYPE : JSON_CONTENT_TYPE);
}

/**
 * Write success response.
 *
 * @param handler The handler.
 * @param request The request.
 * @param response The response.
 * @param value The value.
 * @param contentNegotiation The configured response formatters.
 * @param requestContext The active request context passed to custom response writers.
 * @param validators Validators resolved before the route handler executes.
 * @param conditionalOutcome Matched conditional outcome for formatter-managed responses.
 * @returns The write success response result.
 */
export async function writeSuccessResponse(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  contentNegotiation: ResolvedContentNegotiation | undefined,
  requestContext: RequestContext,
  validators?: ResponseValidators,
  conditionalOutcome?: Exclude<ConditionalRequestOutcome, 'proceed'>,
) {
  if (response.committed) {
    return;
  }

  if (handler.route.redirect) {
    const { url, statusCode = 302 } = handler.route.redirect;
    applyResponseValidators(response, validators);
    response.redirect(statusCode, url);
    return;
  }

  const responseValueFinalizer = readFrameworkResponseValueFinalizer(requestContext);
  const responseValue = responseValueFinalizer
    ? await responseValueFinalizer({ handler, request, requestContext, response, value })
    : value;
  const representation = readFrameworkResponseRepresentation(responseValue);
  const writerValue = readFrameworkResponseWriter(responseValue)
    ? responseValue
    : isByteRangeByteSource(responseValue) && shouldApplyByteRange(request, validators)
      ? createByteRangeResponse(responseValue)
      : undefined;
  const responseWriter = writerValue
    ? readFrameworkResponseWriter(writerValue)
    : undefined;

  if (responseWriter) {
    applyResponseValidators(response, validators);
    let successResponseMetadataApplied = false;
    const applyWriterSuccessResponseMetadata = (): void => {
      if (successResponseMetadataApplied) {
        return;
      }

      successResponseMetadataApplied = true;
      applySuccessResponseMetadata({ formatter: undefined, handler, response, value: responseValue });
      applyResponseValidators(response, validators);
    };

    if (representation) {
      if (requestsRepresentation(request, representation)) {
        const body = await representation.body({
          applySuccessResponseMetadata: applyWriterSuccessResponseMetadata,
          handler,
          request,
          requestContext,
          response,
          validators,
          value: writerValue,
        });
        if (request.signal?.aborted === true || request.isAborted?.() === true || response.committed) {
          return;
        }
        applyWriterSuccessResponseMetadata();
        response.setHeader('Content-Type', representation.mediaType);
        const existingHeaders = Object.entries(response.headers);
        const variesOnlyByAccept = existingHeaders
          .filter(([name]) => name.toLowerCase() === 'vary')
          .every(([, value]) =>
            (Array.isArray(value) ? value : [value])
              .flatMap((entry) => entry.split(','))
              .every((field) => field.trim().toLowerCase() === 'accept'));
        const hasExistingHeader = (name: string): boolean => existingHeaders.some(
          ([headerName, value]) => headerName.toLowerCase() === name && value !== undefined,
        );
        const hasIdentityHeader = Object.entries(request.headers).some(
          ([name, value]) => (name.toLowerCase() === 'cookie' || name.toLowerCase() === 'authorization')
            && value !== undefined,
        );
        const grantsPrefetch = representation.mediaType === NAVIGATION_CONTENT_TYPE
          && request.method.toUpperCase() === 'GET'
          && representation.prefetch === 'public'
          && response.statusCode === 200
          && !hasIdentityHeader
          && !hasExistingHeader('set-cookie')
          && !hasExistingHeader('cache-control')
          && variesOnlyByAccept;
        appendVaryHeader(response, 'Accept');
        for (const [name] of existingHeaders) {
          if (name.toLowerCase() === 'x-fluo-navigation-prefetch') {
            delete response.headers[name];
          }
        }
        if (grantsPrefetch) {
          response.setHeader('X-Fluo-Navigation-Prefetch', 'public');
          response.setHeader('Cache-Control', 'public, max-age=15');
        } else {
          const cacheControlHeaders = existingHeaders.filter(
            ([name, value]) => name.toLowerCase() === 'cache-control' && value !== undefined,
          );
          for (const [name] of cacheControlHeaders) {
            delete response.headers[name];
          }
          response.setHeader(
            cacheControlHeaders[0]?.[0] ?? 'Cache-Control',
            [
              ...cacheControlHeaders.flatMap(([, value]) => Array.isArray(value) ? value : [value]),
              'private, no-store',
            ].join(', '),
          );
        }
        return response.send(body);
      }
      appendVaryHeader(response, 'Accept');
    }

    return responseWriter({
      applySuccessResponseMetadata: applyWriterSuccessResponseMetadata,
      handler,
      request,
      requestContext,
      response,
      validators,
      value: writerValue,
    });
  }

  const responsePolicy = resolveResponsePolicy(handler, request, contentNegotiation);
  const { formatter } = responsePolicy;

  if (conditionalOutcome !== undefined) {
    applyRouteHeaders(handler, response);
    return writeConditionalResponse(response, conditionalOutcome, validators, responsePolicy);
  }

  applySuccessResponseMetadata({ formatter, handler, response, value: responseValue });
  if (responsePolicy.variesByAccept) {
    appendVaryHeader(response, 'Accept');
  }
  applyResponseValidators(response, validators);

  if (request.method.toUpperCase() === 'HEAD') {
    applyImplicitHeadContentType(response, responseValue);
    return response.send(undefined);
  }

  if (!formatter && hasSimpleJsonResponseWriter(response) && canUseSimpleJsonFastPath(response, responseValue)) {
    return response.sendSimpleJson(responseValue);
  }

  const responseBody = formatter
    ? formatter.format(responseValue)
    : responseValue;
  return response.send(responseBody);
}

/**
 * Writes a bodyless conditional response through every supported adapter facade.
 *
 * @param response Mutable adapter-normalized response.
 * @param outcome Selected non-proceed conditional request outcome.
 * @param validators Current representation validators.
 * @param responsePolicy Selected representation metadata.
 * @returns A promise that settles after the adapter accepts the bodyless response.
 */
export async function writeConditionalResponse(
  response: FrameworkResponse,
  outcome: Exclude<ConditionalRequestOutcome, 'proceed'>,
  validators: ResponseValidators | undefined,
  responsePolicy: ResolvedResponsePolicy,
): Promise<void> {
  applyResponseValidators(response, validators);
  if (responsePolicy.variesByAccept) {
    appendVaryHeader(response, 'Accept');
  }
  response.setStatus(outcome === 'not-modified' ? 304 : 412);
  await response.send(undefined);
}

export type { ResolvedContentNegotiation };
export { resolveContentNegotiation, writeErrorResponse };
