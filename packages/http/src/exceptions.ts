import { KonektiError, type MetadataSource } from '@konekti/core';

export interface HttpExceptionDetail {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

export interface HttpExceptionOptions {
  cause?: unknown;
  code?: string;
  details?: HttpExceptionDetail[];
  meta?: Record<string, unknown>;
}

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

export class BadRequestException extends HttpException {
  constructor(message = 'Bad request.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(400, message, { ...options, code: 'BAD_REQUEST' });
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Authentication required.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(401, message, { ...options, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Access denied.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(403, message, { ...options, code: 'FORBIDDEN' });
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Resource not found.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(404, message, { ...options, code: 'NOT_FOUND' });
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(409, message, { ...options, code: 'CONFLICT' });
  }
}

export class NotAcceptableException extends HttpException {
  constructor(message = 'Not acceptable.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(406, message, { ...options, code: 'NOT_ACCEPTABLE' });
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(429, message, { ...options, code: 'TOO_MANY_REQUESTS' });
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(message = 'Payload too large.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(413, message, { ...options, code: 'PAYLOAD_TOO_LARGE' });
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message = 'Internal server error.', options: Omit<HttpExceptionOptions, 'code'> = {}) {
    super(500, message, { ...options, code: 'INTERNAL_SERVER_ERROR' });
  }
}

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
