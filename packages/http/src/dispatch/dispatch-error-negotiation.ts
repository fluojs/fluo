import type { RequestContext } from '../types.js';

const HTML_MEDIA_TYPE = 'text/html';
const JSON_MEDIA_TYPE = 'application/json';

export type ErrorRepresentationKind = 'html' | 'json';

type AcceptRange = {
  readonly mediaRange: string;
  readonly order: number;
  readonly quality: number;
  readonly specificity: number;
};

type RepresentationCandidate = {
  readonly kind: ErrorRepresentationKind;
  readonly priority: number;
  readonly quality: number;
  readonly specificity: number;
};

function parseQuality(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

function mediaRangeSpecificity(mediaRange: string): number {
  if (mediaRange === '*/*') {
    return 0;
  }
  return mediaRange.endsWith('/*') ? 1 : 2;
}

function parseAcceptHeader(value: string): readonly AcceptRange[] {
  const ranges: AcceptRange[] = [];

  for (const [order, token] of value.split(',').entries()) {
    const [rawMediaRange, ...parameters] = token.trim().split(';');
    const mediaRange = rawMediaRange?.trim().toLowerCase() ?? '';

    if (!mediaRange.includes('/')) {
      continue;
    }

    const qualityParameter = parameters
      .map((parameter) => parameter.trim().split('='))
      .find(([name]) => name?.toLowerCase() === 'q');

    ranges.push({
      mediaRange,
      order,
      quality: parseQuality(qualityParameter?.[1]?.trim()),
      specificity: mediaRangeSpecificity(mediaRange),
    });
  }

  return ranges;
}

function mediaRangeMatches(mediaRange: string, mediaType: string): boolean {
  const [rangeType, rangeSubtype] = mediaRange.split('/');
  const [type, subtype] = mediaType.split('/');
  return rangeType !== undefined
    && rangeSubtype !== undefined
    && type !== undefined
    && subtype !== undefined
    && (rangeType === '*' || rangeType === type)
    && (rangeSubtype === '*' || rangeSubtype === subtype);
}

function bestRangeForMediaType(ranges: readonly AcceptRange[], mediaType: string): AcceptRange | undefined {
  return ranges
    .filter((range) => mediaRangeMatches(range.mediaRange, mediaType))
    .sort((left, right) => right.specificity - left.specificity || left.order - right.order)[0];
}

export function readAcceptHeader(context: RequestContext): string | undefined {
  const raw = context.request.headers.accept ?? context.request.headers.Accept;
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function canNegotiateHtml(acceptHeader: string | undefined): boolean {
  if (acceptHeader === undefined) {
    return false;
  }

  const range = bestRangeForMediaType(parseAcceptHeader(acceptHeader), HTML_MEDIA_TYPE);
  return range !== undefined && range.quality > 0;
}

export function selectErrorRepresentation(
  acceptHeader: string | undefined,
  htmlAvailable: boolean,
): ErrorRepresentationKind | undefined {
  if (acceptHeader === undefined) {
    return 'json';
  }

  const ranges = parseAcceptHeader(acceptHeader);
  const offers: readonly {
    readonly kind: ErrorRepresentationKind;
    readonly mediaType: string;
    readonly priority: number;
  }[] = htmlAvailable
    ? [
        { kind: 'json', mediaType: JSON_MEDIA_TYPE, priority: 0 },
        { kind: 'html', mediaType: HTML_MEDIA_TYPE, priority: 1 },
      ]
    : [{ kind: 'json', mediaType: JSON_MEDIA_TYPE, priority: 0 }];
  const candidates: RepresentationCandidate[] = [];

  for (const offer of offers) {
    const range = bestRangeForMediaType(ranges, offer.mediaType);
    if (range !== undefined && range.quality > 0) {
      candidates.push({
        kind: offer.kind,
        priority: offer.priority,
        quality: range.quality,
        specificity: range.specificity,
      });
    }
  }

  candidates.sort((left, right) => (
    right.quality - left.quality
    || right.specificity - left.specificity
    || left.priority - right.priority
  ));
  return candidates[0]?.kind;
}
