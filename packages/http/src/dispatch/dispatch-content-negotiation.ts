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
const MEDIA_TYPE_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizeMediaType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function readAcceptHeader(request: FrameworkRequest): string | undefined {
  return readFirstNonEmptyRequestHeaderValue(request, 'accept');
}

function parseQuality(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) {
    return undefined;
  }

  return Number(value);
}

function getMediaRangeSpecificity(mediaRange: string): number {
  if (mediaRange === '*/*') {
    return 0;
  }

  if (mediaRange.endsWith('/*')) {
    return 1;
  }

  const [, subtype] = mediaRange.split('/');
  return subtype?.startsWith('*+') === true ? 2 : 3;
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
    let qualitySeen = false;
    let malformed = false;

    for (const parameterPart of parameterParts) {
      const [name, value, ...extraValues] = parameterPart.trim().split('=');

      if (name?.toLowerCase() === 'q') {
        const parsedQuality = extraValues.length === 0 ? parseQuality(value?.trim()) : undefined;
        if (qualitySeen || parsedQuality === undefined) {
          malformed = true;
          break;
        }
        quality = parsedQuality;
        qualitySeen = true;
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

function isValidMediaRange(mediaRange: string): boolean {
  const parts = mediaRange.split('/');
  if (parts.length !== 2) {
    return false;
  }

  const [type, subtype] = parts;
  if (!type || !subtype) {
    return false;
  }

  if (type === '*') {
    return subtype === '*';
  }

  if (!MEDIA_TYPE_TOKEN_PATTERN.test(type)) {
    return false;
  }

  if (subtype === '*') {
    return true;
  }

  if (subtype.startsWith('*+')) {
    const suffix = subtype.slice(2);
    return suffix.length > 0 && MEDIA_TYPE_TOKEN_PATTERN.test(suffix);
  }

  return !subtype.includes('*') && MEDIA_TYPE_TOKEN_PATTERN.test(subtype);
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

interface FormatterCandidate {
  formatter: ResponseFormatter;
  formatterIndex: number;
  token: AcceptToken;
}

function selectPreferredCandidate(
  current: FormatterCandidate | undefined,
  candidate: FormatterCandidate,
  defaultFormatter: ResponseFormatter,
): FormatterCandidate {
  if (!current) {
    return candidate;
  }

  if (candidate.token.quality !== current.token.quality) {
    return candidate.token.quality > current.token.quality ? candidate : current;
  }

  if (candidate.token.specificity !== current.token.specificity) {
    return candidate.token.specificity > current.token.specificity ? candidate : current;
  }

  if (candidate.token.order !== current.token.order) {
    return candidate.token.order < current.token.order ? candidate : current;
  }

  const candidateIsDefault = candidate.formatter === defaultFormatter;
  const currentIsDefault = current.formatter === defaultFormatter;
  if (candidateIsDefault !== currentIsDefault) {
    return candidateIsDefault ? candidate : current;
  }

  return candidate.formatterIndex < current.formatterIndex ? candidate : current;
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

  let selected: FormatterCandidate | undefined;

  for (let formatterIndex = 0; formatterIndex < allowedFormatters.length; formatterIndex++) {
    const formatter = allowedFormatters[formatterIndex]!;
    const normalizedMediaType = allowedNormalizedMediaTypes[formatterIndex]!;
    let controllingToken: AcceptToken | undefined;

    for (const token of acceptTokens) {
      if (!matchesMediaRange(token.mediaRange, normalizedMediaType)) {
        continue;
      }

      if (
        controllingToken === undefined
        || token.specificity > controllingToken.specificity
        || (
          token.specificity === controllingToken.specificity
          && token.order < controllingToken.order
        )
      ) {
        controllingToken = token;
      }
    }

    if (controllingToken && controllingToken.quality > 0) {
      selected = selectPreferredCandidate(
        selected,
        { formatter, formatterIndex, token: controllingToken },
        defaultFormatter,
      );
    }
  }

  if (selected) {
    return selected.formatter;
  }

  throw new NotAcceptableException(NO_ACCEPTABLE_REPRESENTATION_MESSAGE);
}
