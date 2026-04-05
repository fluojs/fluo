import { KonektiError, type MetadataSource } from '@konekti/core';

export interface HttpExceptionDetail {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

/**
 * Optional metadata used when creating an {@link HttpException}.
 *
 * @param cause Original error or value that triggered this HTTP exception.
 * @param code Stable application-level error code serialized into API responses.
 * @param details Field-level or source-level details for validation and binding failures.
 * @param meta Additional structured metadata serialized for observability and client diagnostics.
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

  /**
   * Creates an HTTP exception with status, message, and optional structured error metadata.
   *
   * @param status HTTP status code used by the dispatcher when writing the error response.
   * @param message Human-readable error message exposed in the serialized envelope.
   * @param options Optional structured metadata including `code`, `details`, `meta`, and `cause`.
   */
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
  /**
   * Creates a 400 Bad Request exception.
   *
   * @param message Human-readable reason for rejecting the request.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Bad request.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(400, message, { ...options, code: 'BAD_REQUEST' });
  }
}

/**
 * HTTP 401 Unauthorized exception.
 */
export class UnauthorizedException extends HttpException {
  /**
   * Creates a 401 Unauthorized exception.
   *
   * @param message Human-readable authentication failure reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Authentication required.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(401, message, { ...options, code: 'UNAUTHORIZED' });
  }
}

/**
 * HTTP 403 Forbidden exception.
 */
export class ForbiddenException extends HttpException {
  /**
   * Creates a 403 Forbidden exception.
   *
   * @param message Human-readable authorization failure reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Access denied.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(403, message, { ...options, code: 'FORBIDDEN' });
  }
}

/**
 * HTTP 404 Not Found exception.
 */
export class NotFoundException extends HttpException {
  /**
   * Creates a 404 Not Found exception.
   *
   * @param message Human-readable missing-resource reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Resource not found.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(404, message, { ...options, code: 'NOT_FOUND' });
  }
}

/**
 * HTTP 409 Conflict exception.
 */
export class ConflictException extends HttpException {
  /**
   * Creates a 409 Conflict exception.
   *
   * @param message Human-readable conflict reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Conflict.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(409, message, { ...options, code: 'CONFLICT' });
  }
}

/**
 * HTTP 406 Not Acceptable exception.
 */
export class NotAcceptableException extends HttpException {
  /**
   * Creates a 406 Not Acceptable exception.
   *
   * @param message Human-readable content-negotiation failure reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Not acceptable.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(406, message, { ...options, code: 'NOT_ACCEPTABLE' });
  }
}

/**
 * HTTP 429 Too Many Requests exception.
 */
export class TooManyRequestsException extends HttpException {
  /**
   * Creates a 429 Too Many Requests exception.
   *
   * @param message Human-readable throttling reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Too many requests.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(429, message, { ...options, code: 'TOO_MANY_REQUESTS' });
  }
}

/**
 * HTTP 413 Payload Too Large exception.
 */
export class PayloadTooLargeException extends HttpException {
  /**
   * Creates a 413 Payload Too Large exception.
   *
   * @param message Human-readable payload-size failure reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Payload too large.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(413, message, { ...options, code: 'PAYLOAD_TOO_LARGE' });
  }
}

/**
 * HTTP 500 Internal Server Error exception.
 */
export class InternalServerErrorException extends HttpException {
  /**
   * Creates a 500 Internal Server Error exception.
   *
   * @param message Human-readable server-side failure reason.
   * @param options Optional structured details and metadata serialized in the error envelope.
   */
  constructor(message = 'Internal server error.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(500, message, { ...options, code: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Converts an {@link HttpException} to the standard serialized error envelope.
 *
 * @param error HTTP exception produced by application code or the dispatcher pipeline.
 * @param requestId Optional request identifier attached by runtime correlation middleware.
 * @returns The canonical `{ error: ... }` payload returned to HTTP clients.
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
