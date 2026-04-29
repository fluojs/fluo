import {
  resolveContentNegotiation,
  selectResponseFormatter,
  type ResolvedContentNegotiation,
} from './dispatch-content-negotiation.js';
import { writeErrorResponse } from './dispatch-error-policy.js';
import type {
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
} from '../types.js';

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

/**
 * Write success response.
 *
 * @param handler The handler.
 * @param request The request.
 * @param response The response.
 * @param value The value.
 * @param contentNegotiation The content negotiation.
 * @returns The write success response result.
 */
export async function writeSuccessResponse(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  contentNegotiation: ResolvedContentNegotiation | undefined,
): Promise<void> {
  if (response.committed) {
    return;
  }

  if (handler.route.redirect) {
    const { url, statusCode = 302 } = handler.route.redirect;
    response.redirect(statusCode, url);
    return;
  }

  const formatter = contentNegotiation
    ? selectResponseFormatter(handler, request, contentNegotiation)
    : undefined;

  // Write route-level headers only after successful formatter negotiation so
  // that a negotiation failure does not leak success-only headers onto the
  // error response.
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

  const responseBody = formatter
    ? formatter.format(value)
    : value;
  await response.send(responseBody);
}

export { resolveContentNegotiation, writeErrorResponse };
export type { ResolvedContentNegotiation };
