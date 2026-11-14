import { type AcceptToken, parseAcceptHeader, selectMostSpecificAcceptToken } from './dispatch-accept.js';
import { NotAcceptableException } from '../exceptions.js';
import { readJoinedNonEmptyRequestHeaderValues } from '../header-helpers.js';
import type {
  ContentNegotiationOptions,
  FrameworkRequest,
  HandlerDescriptor,
  ResponseFormatter,
} from '../types.js';

/**
 * Describes the resolved content negotiation contract.
 */
export interface ResolvedContentNegotiation {
  defaultFormatter: ResponseFormatter;
  formatters: ResponseFormatter[];
  normalizedMediaTypes: string[];
}

const NO_ACCEPTABLE_REPRESENTATION_MESSAGE = 'No acceptable response representation found.';

class ContentNegotiationNotAcceptableException extends NotAcceptableException {}

function normalizeMediaType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function readAcceptHeader(request: FrameworkRequest): string | undefined {
  return readJoinedNonEmptyRequestHeaderValues(request, 'accept');
}

/**
 * Determines whether an error originated from response content negotiation.
 *
 * @param error Candidate error emitted while selecting a response formatter.
 * @returns Whether the error requires `Vary: Accept` on its representation.
 */
export function isContentNegotiationNotAcceptableException(
  error: unknown,
): error is NotAcceptableException {
  return error instanceof ContentNegotiationNotAcceptableException;
}

/**
 * Resolve content negotiation.
 *
 * @param options The options.
 * @returns The resolve content negotiation result.
 */
export function resolveContentNegotiation(options: ContentNegotiationOptions | undefined): ResolvedContentNegotiation | undefined {
  if (!options?.formatters?.length) {
    return undefined;
  }

  const seen = new Set<string>();
  const formatters = options.formatters.filter((formatter) => {
    const mediaType = normalizeMediaType(formatter.mediaType);

    if (!mediaType || seen.has(mediaType)) {
      return false;
    }

    seen.add(mediaType);
    return true;
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
    normalizedMediaTypes: formatters.map((f) => normalizeMediaType(f.mediaType)),
  };
}

function resolveAllowedFormatters(
  handler: HandlerDescriptor,
  contentNegotiation: ResolvedContentNegotiation,
): { formatters: ResponseFormatter[]; normalizedMediaTypes: string[] } {
  if (!handler.route.produces?.length) {
    return { formatters: contentNegotiation.formatters, normalizedMediaTypes: contentNegotiation.normalizedMediaTypes };
  }

  const allowed = new Set(handler.route.produces.map((mediaType) => normalizeMediaType(mediaType)));
  const formatters: ResponseFormatter[] = [];
  const normalizedMediaTypes: string[] = [];

  for (let i = 0; i < contentNegotiation.formatters.length; i++) {
    const normalized = contentNegotiation.normalizedMediaTypes[i]!;

    if (allowed.has(normalized)) {
      formatters.push(contentNegotiation.formatters[i]!);
      normalizedMediaTypes.push(normalized);
    }
  }

  return { formatters, normalizedMediaTypes };
}

function resolveDefaultFormatter(
  allowedFormatters: ResponseFormatter[],
  allowedNormalizedMediaTypes: string[],
  contentNegotiation: ResolvedContentNegotiation,
): ResponseFormatter {
  const defaultMediaType = normalizeMediaType(contentNegotiation.defaultFormatter.mediaType);
  const idx = allowedNormalizedMediaTypes.indexOf(defaultMediaType);

  return idx >= 0 ? allowedFormatters[idx]! : (allowedFormatters[0] ?? contentNegotiation.defaultFormatter);
}

/**
 * Select response formatter.
 *
 * @param handler The handler.
 * @param request The request.
 * @param contentNegotiation The content negotiation.
 * @returns The select response formatter result.
 */
export function selectResponseFormatter(
  handler: HandlerDescriptor,
  request: FrameworkRequest,
  contentNegotiation: ResolvedContentNegotiation,
): ResponseFormatter {
  const { formatters: allowedFormatters, normalizedMediaTypes: allowedNormalizedMediaTypes } = resolveAllowedFormatters(
    handler,
    contentNegotiation,
  );

  if (!allowedFormatters.length) {
    throw new ContentNegotiationNotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
  }

  const defaultFormatter = resolveDefaultFormatter(allowedFormatters, allowedNormalizedMediaTypes, contentNegotiation);
  const acceptHeader = readAcceptHeader(request);

  if (!acceptHeader) {
    return defaultFormatter;
  }

  const acceptTokens = parseAcceptHeader(acceptHeader);

  if (!acceptTokens.length) {
    throw new ContentNegotiationNotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
  }

  let selectedFormatter: ResponseFormatter | undefined;
  let selectedToken: AcceptToken | undefined;

  for (let i = 0; i < allowedFormatters.length; i++) {
    const formatter = allowedFormatters[i]!;
    const token = selectMostSpecificAcceptToken(allowedNormalizedMediaTypes[i]!, acceptTokens);

    if (
      !token
      || token.quality === 0
      || (
        selectedToken
        && (
          token.quality < selectedToken.quality
          || (token.quality === selectedToken.quality && token.specificity < selectedToken.specificity)
        )
      )
    ) {
      continue;
    }

    if (
      !selectedToken
      || token.quality > selectedToken.quality
      || token.specificity > selectedToken.specificity
      || formatter === defaultFormatter
    ) {
      selectedFormatter = formatter;
      selectedToken = token;
    }
  }

  if (selectedFormatter) {
    return selectedFormatter;
  }

  throw new ContentNegotiationNotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
}
