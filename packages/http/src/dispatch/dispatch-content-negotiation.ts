import { NotAcceptableException } from '../exceptions.js';
import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ContentNegotiationOptions,
  FrameworkRequest,
  HandlerDescriptor,
  ResponseFormatter,
} from '../types.js';

interface AcceptToken {
  mediaRange: string;
  order: number;
  quality: number;
  specificity: number;
}

/**
 * Describes the resolved content negotiation contract.
 */
export interface ResolvedContentNegotiation {
  defaultFormatter: ResponseFormatter;
  formatters: ResponseFormatter[];
  normalizedMediaTypes: string[];
}

const NO_ACCEPTABLE_REPRESENTATION_MESSAGE = 'No acceptable response representation found.';

function normalizeMediaType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function readAcceptHeader(request: FrameworkRequest): string | undefined {
  return readFirstNonEmptyRequestHeaderValue(request, 'accept');
}

function parseQuality(value: string): number | undefined {
  if (!/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(value)) {
    return undefined;
  }

  return Number(value);
}

function isValidMediaRange(mediaRange: string): boolean {
  const [type, subtype, extra] = mediaRange.split('/');

  if (!type || !subtype || extra !== undefined) {
    return false;
  }

  if (type === '*') {
    return subtype === '*';
  }

  if (type.includes('*')) {
    return false;
  }

  if (subtype === '*') {
    return true;
  }

  if (subtype.startsWith('*+')) {
    return subtype.length > 2 && !subtype.slice(2).includes('*');
  }

  return !subtype.includes('*');
}

function getMediaRangeSpecificity(mediaRange: string): number {
  if (mediaRange === '*/*') {
    return 0;
  }

  if (mediaRange.endsWith('/*')) {
    return 1;
  }

  return mediaRange.includes('/*+') ? 2 : 3;
}

function parseAcceptHeader(acceptHeader: string): AcceptToken[] {
  const tokens: AcceptToken[] = [];

  for (const [order, token] of acceptHeader.split(',').entries()) {
    const [rawMediaRange, ...parameterParts] = token.trim().split(';');
    const mediaRange = normalizeMediaType(rawMediaRange ?? '');

    if (!isValidMediaRange(mediaRange)) {
      continue;
    }

    let quality = 1;
    let qualityDefined = false;
    let malformed = false;

    for (const parameterPart of parameterParts) {
      const [name, ...rawValues] = parameterPart.trim().split('=');

      if (name?.toLowerCase() === 'q') {
        if (qualityDefined || rawValues.length !== 1) {
          malformed = true;
          break;
        }

        const parsedQuality = parseQuality(rawValues[0]?.trim() ?? '');
        if (parsedQuality === undefined) {
          malformed = true;
          break;
        }

        quality = parsedQuality;
        qualityDefined = true;
      }
    }

    if (malformed) {
      continue;
    }

    tokens.push({
      mediaRange,
      order,
      quality,
      specificity: getMediaRangeSpecificity(mediaRange),
    });
  }

  return tokens;
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

  if (rangeSubtype === '*') {
    return true;
  }

  if (rangeSubtype.startsWith('*+')) {
    return mediaTypeSubtype.endsWith(rangeSubtype.slice(1));
  }

  return rangeSubtype === mediaTypeSubtype;
}

function selectMostSpecificAcceptToken(
  mediaType: string,
  acceptTokens: readonly AcceptToken[],
): AcceptToken | undefined {
  let selected: AcceptToken | undefined;

  for (const token of acceptTokens) {
    if (!matchesMediaRange(token.mediaRange, mediaType)) {
      continue;
    }

    if (
      !selected
      || token.specificity > selected.specificity
      || (token.specificity === selected.specificity && token.order < selected.order)
    ) {
      selected = token;
    }
  }

  return selected;
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
    throw new NotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
  }

  const defaultFormatter = resolveDefaultFormatter(allowedFormatters, allowedNormalizedMediaTypes, contentNegotiation);
  const acceptHeader = readAcceptHeader(request);

  if (!acceptHeader) {
    return defaultFormatter;
  }

  const acceptTokens = parseAcceptHeader(acceptHeader);

  if (!acceptTokens.length) {
    throw new NotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
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

  throw new NotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
}
