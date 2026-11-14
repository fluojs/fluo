/** Parsed media range shared by success and error negotiation. */
export interface AcceptToken {
  mediaRange: string;
  order: number;
  quality: number;
  specificity: number;
}

function parseQuality(value: string): number | undefined {
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) {
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

/**
 * Parses strict media ranges, ignoring each malformed range or quality.
 *
 * @param acceptHeader Accept field value selected by the caller.
 * @returns Valid ranges in their original field order.
 */
export function parseAcceptHeader(acceptHeader: string): AcceptToken[] {
  const tokens: AcceptToken[] = [];

  for (const [order, token] of acceptHeader.split(',').entries()) {
    const [rawMediaRange, ...parameterParts] = token.trim().split(';');
    const mediaRange = rawMediaRange?.trim().toLowerCase() ?? '';

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

/**
 * Resolves an offer's quality from its most specific matching range.
 *
 * @param mediaType Normalized media type offered by the caller.
 * @param acceptTokens Parsed ranges in the Accept field.
 * @returns The most specific range, with original order breaking equal specificity.
 */
export function selectMostSpecificAcceptToken(
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
