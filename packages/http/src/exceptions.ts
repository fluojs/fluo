import { KonektiError, type MetadataSource } from '@konekti/core';

export interface HttpExceptionDetail {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

/**
 * Optional metadata used when creating an {@link HttpException}.
 */
export interface HttpExceptionOptions {
  cause?: unknown;
  code?: string;
  details?: HttpExceptionDetail[];
  meta?: Record<string, unknown>;
}

/**
 * Canonical HTTP error response envelope.
 */
export interface ErrorResponse {
  error: {
    code: string;
    details?: HttpExceptionDetail[];
    message: string;
    meta?: Record<string, unknown>;
    requestId?: string;
    status: number;
  };
}

/**
 * Base HTTP exception type used by the dispatcher error serializer.
 */
export class HttpException extends KonektiError {
  readonly details?: HttpExceptionDetail[];
  readonly status: number;

  constructor(status: number, message: string, options: HttpExceptionOptions = {}) {
    super(message, {
      cause: options.cause,
      code: options.code,
      meta: options.meta,
    });

    this.details = options.details ? [...options.details] : undefined;
    this.status = status;
  }
}

/**
 * HTTP 400 Bad Request exception.
 */
export class BadRequestException extends HttpException {
  constructor(message = 'Bad request.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(400, message, { ...options, code: 'BAD_REQUEST' });
  }
}

/**
 * HTTP 401 Unauthorized exception.
 */
export class UnauthorizedException extends HttpException {
  constructor(message = 'Authentication required.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(401, message, { ...options, code: 'UNAUTHORIZED' });
  }
}

/**
 * HTTP 403 Forbidden exception.
 */
export class ForbiddenException extends HttpException {
  constructor(message = 'Access denied.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(403, message, { ...options, code: 'FORBIDDEN' });
  }
}

/**
 * HTTP 404 Not Found exception.
 */
export class NotFoundException extends HttpException {
  constructor(message = 'Resource not found.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(404, message, { ...options, code: 'NOT_FOUND' });
  }
}

/**
 * HTTP 409 Conflict exception.
 */
export class ConflictException extends HttpException {
  constructor(message = 'Conflict.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(409, message, { ...options, code: 'CONFLICT' });
  }
}

/**
 * HTTP 406 Not Acceptable exception.
 */
export class NotAcceptableException extends HttpException {
  constructor(message = 'Not acceptable.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(406, message, { ...options, code: 'NOT_ACCEPTABLE' });
  }
}

/**
 * HTTP 429 Too Many Requests exception.
 */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(429, message, { ...options, code: 'TOO_MANY_REQUESTS' });
  }
}

/**
 * HTTP 413 Payload Too Large exception.
 */
export class PayloadTooLargeException extends HttpException {
  constructor(message = 'Payload too large.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(413, message, { ...options, code: 'PAYLOAD_TOO_LARGE' });
  }
}

/**
 * HTTP 500 Internal Server Error exception.
 */
export class InternalServerErrorException extends HttpException {
  constructor(message = 'Internal server error.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(500, message, { ...options, code: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Converts an {@link HttpException} to the standard serialized error envelope.
 */
export function createErrorResponse(error: HttpException, requestId?: string): ErrorResponse {
  return {
    error: {
      code: error.code,
      details: error.details,
      message: error.message,
      meta: error.meta,
      requestId,
      status: error.status,
    },
  };
}
