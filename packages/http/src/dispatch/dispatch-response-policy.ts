import type {
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
  ResponseFormatter,
} from '../types.js';
import {
  FRAMEWORK_RESPONSE_VALUE_FINALIZER,
  FRAMEWORK_RESPONSE_WRITER,
  type FrameworkResponseValueFinalizer,
  type FrameworkResponseWriter,
} from './response-integration.js';
import {
  type ResolvedContentNegotiation,
  resolveContentNegotiation,
  selectResponseFormatter,
} from './dispatch-content-negotiation.js';
import { writeErrorResponse } from './dispatch-error-policy.js';

type SimpleJsonResponseBody = Record<string, unknown> | unknown[];
const BINARY_CONTENT_TYPE = 'application/octet-stream';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

type SimpleJsonFrameworkResponse = FrameworkResponse & {
  sendSimpleJson(body: SimpleJsonResponseBody): ReturnType<FrameworkResponse['send']>;
};

type SuccessResponseMetadataContext = {
  readonly formatter: ResponseFormatter | undefined;
  readonly handler: HandlerDescriptor;
  readonly response: FrameworkResponse;
  readonly value: unknown;
};

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

  for (const header of handler.route.headers ?? []) {
    response.setHeader(header.name, header.value);
  }

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
 * @param contentNegotiation The content negotiation.
 * @param requestContext The active request context passed to custom response writers.
 * @returns The write success response result.
 */
export function writeSuccessResponse(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  contentNegotiation: ResolvedContentNegotiation | undefined,
  requestContext: RequestContext,
): ReturnType<FrameworkResponse['send']> | void {
  if (response.committed) {
    return;
  }

  if (handler.route.redirect) {
    const { url, statusCode = 302 } = handler.route.redirect;
    response.redirect(statusCode, url);
    return;
  }

  const responseValueFinalizer = readFrameworkResponseValueFinalizer(requestContext);
  const responseValue = responseValueFinalizer
    ? responseValueFinalizer({ handler, request, requestContext, response, value })
    : value;
  const responseWriter = readFrameworkResponseWriter(responseValue);

  if (responseWriter) {
    let successResponseMetadataApplied = false;
    const applyWriterSuccessResponseMetadata = (): void => {
      if (successResponseMetadataApplied) {
        return;
      }

      successResponseMetadataApplied = true;
      applySuccessResponseMetadata({ formatter: undefined, handler, response, value: responseValue });
    };

    return responseWriter({
      applySuccessResponseMetadata: applyWriterSuccessResponseMetadata,
      handler,
      request,
      requestContext,
      response,
    });
  }

  const formatter = contentNegotiation
    ? selectResponseFormatter(handler, request, contentNegotiation)
    : undefined;

  applySuccessResponseMetadata({ formatter, handler, response, value: responseValue });

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

export type { ResolvedContentNegotiation };
export { resolveContentNegotiation, writeErrorResponse };
