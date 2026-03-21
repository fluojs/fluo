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
} from './types.js';

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

export { resolveContentNegotiation, writeErrorResponse };
export type { ResolvedContentNegotiation };
