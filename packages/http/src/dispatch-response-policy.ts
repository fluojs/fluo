import { HandlerNotFoundError } from './errors.js';
import {
  HttpException,
  InternalServerException,
  NotAcceptableException,
  NotFoundException,
  createErrorResponse,
} from './exceptions.js';
import type {
  ContentNegotiationOptions,
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  ResponseFormatter,
} from './types.js';

interface AcceptToken {
  mediaRange: string;
  quality: number;
  specificity: number;
}

export interface ResolvedContentNegotiation {
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

export function resolveContentNegotiation(options: ContentNegotiationOptions | undefined): ResolvedContentNegotiation | undefined {
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
    throw new NotAcceptableException('No acceptable response representation found.');
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
