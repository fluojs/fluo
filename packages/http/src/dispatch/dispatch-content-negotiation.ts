import { NotAcceptableException } from '../exceptions.js';
import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ContentNegotiationOptions,
  FrameworkRequest,
  HandlerDescriptor,
  ResponseFormatter,
} from '../types.js';

interface MediaParameter {
  name: string;
  value: string;
}

interface AcceptToken {
  mediaParameters: MediaParameter[];
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

function splitOutsideQuotedStrings(
  value: string,
  delimiter: string,
  preserveCompletedPartsOnMalformedTail = false,
): string[] | undefined {
  const parts: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;

    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted || escaped) {
    return preserveCompletedPartsOnMalformedTail ? parts : undefined;
  }

  parts.push(value.slice(start));
  return parts;
}

function parseParameter(parameter: string): [name: string, value: string] | undefined {
  let equalsIndex = -1;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < parameter.length; index++) {
    const character = parameter[index]!;

    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === '=') {
      if (equalsIndex >= 0) {
        return undefined;
      }
      equalsIndex = index;
    }
  }

  if (quoted || escaped || equalsIndex <= 0) {
    return undefined;
  }

  const name = parameter.slice(0, equalsIndex);
  const value = parameter.slice(equalsIndex + 1);
  if (!MEDIA_TYPE_TOKEN_PATTERN.test(name) || !isValidParameterValue(value)) {
    return undefined;
  }

  return [name, value];
}

function isValidQuotedTextOctet(character: string): boolean {
  const code = character.charCodeAt(0);

  return code === 0x09
    || (code >= 0x20 && code <= 0x7e && character !== '"' && character !== '\\')
    || (code >= 0x80 && code <= 0xff);
}

function isValidQuotedPairOctet(character: string): boolean {
  const code = character.charCodeAt(0);

  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

function isValidParameterValue(value: string): boolean {
  if (MEDIA_TYPE_TOKEN_PATTERN.test(value)) {
    return true;
  }

  if (value.length < 2 || value[0] !== '"' || value.at(-1) !== '"') {
    return false;
  }

  let escaped = false;
  for (let index = 1; index < value.length - 1; index++) {
    const character = value[index]!;

    if (escaped) {
      if (!isValidQuotedPairOctet(character)) {
        return false;
      }
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (!isValidQuotedTextOctet(character)) {
      return false;
    }
  }

  return !escaped;
}

function normalizeParameterValue(value: string): string {
  if (value[0] !== '"') {
    return value;
  }

  let normalized = '';
  let escaped = false;
  for (let index = 1; index < value.length - 1; index++) {
    const character = value[index]!;

    if (escaped) {
      normalized += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else {
      normalized += character;
    }
  }

  return normalized;
}

function parseMediaType(value: string): { mediaRange: string; parameters: MediaParameter[] } | undefined {
  const parts = splitOutsideQuotedStrings(value.trim(), ';');
  if (!parts) {
    return undefined;
  }

  const [rawMediaRange, ...parameterParts] = parts;
  const mediaRange = normalizeMediaType(rawMediaRange ?? '');
  if (!isValidMediaRange(mediaRange)) {
    return undefined;
  }

  const parameters: MediaParameter[] = [];
  for (const parameterPart of parameterParts) {
    const parameter = parseParameter(parameterPart.trim());
    if (!parameter) {
      return undefined;
    }

    const [name, parameterValue] = parameter;
    parameters.push({ name: name.toLowerCase(), value: normalizeParameterValue(parameterValue) });
  }

  return { mediaRange, parameters };
}

function normalizeRepresentationMediaType(value: string): string {
  const mediaType = parseMediaType(value);
  if (!mediaType) {
    return normalizeMediaType(value);
  }

  const parameters = mediaType.parameters
    .map((parameter) => `${parameter.name}=${parameter.value}`)
    .sort();

  return parameters.length ? `${mediaType.mediaRange};${parameters.join(';')}` : mediaType.mediaRange;
}

function parseAcceptHeader(acceptHeader: string): AcceptToken[] {
  const tokenParts = splitOutsideQuotedStrings(acceptHeader, ',', true);
  if (!tokenParts) {
    return [];
  }

  const tokens: AcceptToken[] = [];

  for (const [order, token] of tokenParts.entries()) {
    const parts = splitOutsideQuotedStrings(token.trim(), ';');
    if (!parts) {
      continue;
    }

    const [rawMediaRange, ...parameterParts] = parts;
    const mediaRange = normalizeMediaType(rawMediaRange ?? '');

    if (!isValidMediaRange(mediaRange)) {
      continue;
    }

    const mediaParameters: MediaParameter[] = [];
    let quality = 1;
    let qualitySeen = false;
    let malformed = false;

    for (const parameterPart of parameterParts) {
      const parameter = parseParameter(parameterPart.trim());
      if (!parameter) {
        malformed = true;
        break;
      }

      const [name, value] = parameter;
      if (name.toLowerCase() === 'q') {
        const parsedQuality = parseQuality(value);
        if (qualitySeen || parsedQuality === undefined) {
          malformed = true;
          break;
        }
        quality = parsedQuality;
        qualitySeen = true;
      } else {
        mediaParameters.push({ name: name.toLowerCase(), value: normalizeParameterValue(value) });
      }
    }

    if (malformed) {
      continue;
    }

    tokens.push({
      mediaParameters,
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

function matchesMediaParameters(mediaParameters: readonly MediaParameter[], mediaType: string): boolean {
  const parsedMediaType = parseMediaType(mediaType);

  return parsedMediaType !== undefined && mediaParameters.every((mediaParameter) => parsedMediaType.parameters.some(
    (parameter) => parameter.name === mediaParameter.name && parameter.value === mediaParameter.value,
  ));
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
    const mediaType = normalizeRepresentationMediaType(formatter.mediaType);

    if (!mediaType || seen.has(mediaType)) {
      return false;
    }

    seen.add(mediaType);
    return true;
  });

  if (!formatters.length) {
    return undefined;
  }

  const defaultMediaType = normalizeRepresentationMediaType(options.defaultMediaType ?? '');
  const defaultFormatter = defaultMediaType
    ? formatters.find((formatter) => normalizeRepresentationMediaType(formatter.mediaType) === defaultMediaType) ?? formatters[0]
    : formatters[0];

  return {
    defaultFormatter,
    formatters,
    normalizedMediaTypes: formatters.map((f) => normalizeRepresentationMediaType(f.mediaType)),
  };
}

function resolveAllowedFormatters(
  handler: HandlerDescriptor,
  contentNegotiation: ResolvedContentNegotiation,
): { formatters: ResponseFormatter[]; normalizedMediaTypes: string[] } {
  if (!handler.route.produces?.length) {
    return { formatters: contentNegotiation.formatters, normalizedMediaTypes: contentNegotiation.normalizedMediaTypes };
  }

  const allowed = new Set(handler.route.produces.map((mediaType) => normalizeRepresentationMediaType(mediaType)));
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
  const defaultMediaType = normalizeRepresentationMediaType(contentNegotiation.defaultFormatter.mediaType);
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
    let controllingToken: AcceptToken | undefined;

    for (const token of acceptTokens) {
      if (
        !matchesMediaRange(token.mediaRange, normalizeMediaType(formatter.mediaType))
        || !matchesMediaParameters(token.mediaParameters, formatter.mediaType)
      ) {
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
