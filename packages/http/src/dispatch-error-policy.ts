import { HandlerNotFoundError } from './errors.js';
import {
  HttpException,
  InternalServerException,
  NotFoundException,
  createErrorResponse,
} from './exceptions.js';
import type { FrameworkResponse } from './types.js';

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof HandlerNotFoundError) {
    const message = error instanceof Error ? error.message : 'Resource not found.';
    return new NotFoundException(message, { cause: error });
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}

export async function writeErrorResponse(error: unknown, response: FrameworkResponse, requestId?: string): Promise<void> {
  if (response.committed) {
    return;
  }

  const httpError = toHttpException(error);
  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
}
