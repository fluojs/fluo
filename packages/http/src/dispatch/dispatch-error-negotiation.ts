import { parseAcceptHeader, selectMostSpecificAcceptToken } from './dispatch-accept.js';
import type { RequestContext } from '../types.js';
import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';

const HTML_MEDIA_TYPE = 'text/html';
const JSON_MEDIA_TYPE = 'application/json';

/** Error representation selected by HTTP content negotiation. */
export type ErrorRepresentationKind = 'html' | 'json';

type RepresentationCandidate = {
  readonly kind: ErrorRepresentationKind;
  readonly priority: number;
  readonly quality: number;
  readonly specificity: number;
};

/**
 * Reads the normalized Accept header from one request context.
 *
 * @param context Active HTTP request context.
 * @returns The normalized header value when present.
 */
export function readAcceptHeader(context: RequestContext): string | undefined {
  return readFirstNonEmptyRequestHeaderValue(context.request, 'accept');
}

/**
 * Determines whether an Accept header permits the HTML representation.
 *
 * @param acceptHeader Normalized Accept header value.
 * @returns Whether HTML has a positive matching quality.
 */
export function canNegotiateHtml(acceptHeader: string | undefined): boolean {
  if (acceptHeader === undefined) {
    return false;
  }

  const range = selectMostSpecificAcceptToken(HTML_MEDIA_TYPE, parseAcceptHeader(acceptHeader));
  return range !== undefined && range.quality > 0;
}

/**
 * Selects the deterministic error representation for one Accept header.
 *
 * @param acceptHeader Normalized Accept header value.
 * @param htmlAvailable Whether the application HTML provider is available.
 * @returns The selected representation, or `undefined` when no offer is acceptable.
 */
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
    const range = selectMostSpecificAcceptToken(offer.mediaType, ranges);
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
