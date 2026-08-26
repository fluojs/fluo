import { NotAcceptableException } from '../exceptions.js';
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

function readAcceptHeader(request: FrameworkRequest): string[] {
  const values: string[] = [];

  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() !== 'accept') {
      continue;
    }

    for (const entry of Array.isArray(value) ? value : [value]) {
      const normalized = entry?.trim();
      if (normalized) {
        values.push(normalized);
      }
    }
  }

  return values;
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
  if (!isValidConcreteMediaType(mediaRange)) {
    return undefined;
  }

  const parameters: MediaParameter[] = [];
  const parameterNames = new Set<string>();
  for (const parameterPart of parameterParts) {
    const parameter = parseParameter(parameterPart.trim());
    if (!parameter) {
      return undefined;
    }

    const [name, parameterValue] = parameter;
    const normalizedName = name.toLowerCase();
    if (parameterNames.has(normalizedName)) {
      return undefined;
    }
    parameterNames.add(normalizedName);
    parameters.push({ name: normalizedName, value: normalizeParameterValue(parameterValue) });
  }

  return { mediaRange, parameters };
}

function encodeMediaParameters(parameters: readonly MediaParameter[]): string {
  return parameters
    .map((parameter) => `${parameter.name.length}:${parameter.name}${parameter.value.length}:${parameter.value}`)
    .sort()
    .join('');
}

function normalizeRepresentationMediaType(value: string): string | undefined {
  const mediaType = parseMediaType(value);
  if (!mediaType) {
    return undefined;
  }

  const parameters = encodeMediaParameters(mediaType.parameters);

  return parameters ? `${mediaType.mediaRange};${parameters}` : mediaType.mediaRange;
}

function parseAcceptHeader(acceptHeaders: readonly string[]): AcceptToken[] {
  const tokens: AcceptToken[] = [];
  let order = 0;

  for (const acceptHeader of acceptHeaders) {
    const tokenParts = splitOutsideQuotedStrings(acceptHeader, ',', true);
    if (!tokenParts) {
      continue;
    }

    for (const token of tokenParts) {
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
      const parameterNames = new Set<string>();
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
        const normalizedName = name.toLowerCase();
        if (parameterNames.has(normalizedName) || qualitySeen) {
          malformed = true;
          break;
        }
        parameterNames.add(normalizedName);

        if (normalizedName === 'q') {
          const parsedQuality = parseQuality(value);
          if (parsedQuality === undefined) {
            malformed = true;
            break;
          }
          quality = parsedQuality;
          qualitySeen = true;
        } else {
          mediaParameters.push({ name: normalizedName, value: normalizeParameterValue(value) });
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
      order++;
    }
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

function isValidConcreteMediaType(mediaType: string): boolean {
  if (!isValidMediaRange(mediaType)) {
    return false;
  }

  const [type, subtype] = mediaType.split('/');
  return type !== '*' && subtype !== '*' && subtype?.startsWith('*+') !== true;
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

  if (candidate.token.mediaParameters.length !== current.token.mediaParameters.length) {
    return candidate.token.mediaParameters.length > current.token.mediaParameters.length ? candidate : current;
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
  const candidates: { formatter: ResponseFormatter; mediaType: string }[] = [];

  for (const formatter of options.formatters) {
    const mediaType = normalizeRepresentationMediaType(formatter.mediaType);
    if (!mediaType || seen.has(mediaType)) {
      continue;
    }

    seen.add(mediaType);
    candidates.push({ formatter, mediaType });
  }

  if (!candidates.length) {
    return undefined;
  }

  const defaultMediaType = normalizeRepresentationMediaType(options.defaultMediaType ?? '');
  const defaultFormatter = defaultMediaType
    ? candidates.find((candidate) => candidate.mediaType === defaultMediaType) ?? candidates[0]!
    : candidates[0]!;

  return {
    defaultFormatter: defaultFormatter.formatter,
    formatters: candidates.map((candidate) => candidate.formatter),
    normalizedMediaTypes: candidates.map((candidate) => candidate.mediaType),
  };
}

function resolveAllowedFormatters(
  handler: HandlerDescriptor,
  contentNegotiation: ResolvedContentNegotiation,
): { formatters: ResponseFormatter[]; normalizedMediaTypes: string[] } {
  if (!handler.route.produces?.length) {
    return { formatters: contentNegotiation.formatters, normalizedMediaTypes: contentNegotiation.normalizedMediaTypes };
  }

  const allowed = new Set(
    handler.route.produces
      .map((mediaType) => normalizeRepresentationMediaType(mediaType))
      .filter((mediaType): mediaType is string => mediaType !== undefined),
  );
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
  const idx = defaultMediaType === undefined ? -1 : allowedNormalizedMediaTypes.indexOf(defaultMediaType);

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
  const acceptHeaders = readAcceptHeader(request);

  if (acceptHeaders.length === 0) {
    return defaultFormatter;
  }

  const acceptTokens = parseAcceptHeader(acceptHeaders);

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
          && (
            token.mediaParameters.length > controllingToken.mediaParameters.length
            || (
              token.mediaParameters.length === controllingToken.mediaParameters.length
              && token.order < controllingToken.order
            )
          )
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
