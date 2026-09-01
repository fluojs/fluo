import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ConditionalRequestContext,
  ConditionalRequestOptions,
  EntityTag,
  FrameworkResponse,
  FrameworkResponseSendOptions,
  ResponseValidators,
} from '../types.js';

/** Dispatcher outcome selected by RFC conditional request evaluation. */
export type ConditionalRequestOutcome = 'not-modified' | 'precondition-failed' | 'proceed';

/** Result of one dispatcher-owned conditional request evaluation. */
export interface ConditionalRequestResult {
  /** Whether dispatch continues, produces 304, or produces 412. */
  readonly outcome: ConditionalRequestOutcome;
  /** Current representation validators that must remain visible to adapters. */
  readonly validators: ResponseValidators | undefined;
}

function formatEntityTag(tag: EntityTag): string {
  return `${tag.strength === 'weak' ? 'W/' : ''}"${tag.opaqueValue}"`;
}

type ParsedEntityTagList =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'tags'; readonly tags: readonly EntityTag[] };

const INVALID_ENTITY_TAG_LIST: ParsedEntityTagList = { kind: 'invalid' };
const HTTP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const HTTP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HTTP_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function isOptionalWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t';
}

function isEntityTagCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code === 0x21 || (code >= 0x23 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

function isValidEntityTag(tag: EntityTag): boolean {
  return [...tag.opaqueValue].every(isEntityTagCharacter);
}

function parseEntityTagList(value: string): ParsedEntityTagList {
  let position = 0;

  const skipOptionalWhitespace = (): void => {
    while (isOptionalWhitespace(value[position])) {
      position += 1;
    }
  };

  skipOptionalWhitespace();

  if (value[position] === '*') {
    position += 1;
    skipOptionalWhitespace();
    return position === value.length ? { kind: 'wildcard' } : INVALID_ENTITY_TAG_LIST;
  }

  const tags: EntityTag[] = [];

  while (position < value.length) {
    const weak = value.startsWith('W/', position);

    if (weak) {
      position += 2;
    }

    if (value[position] !== '"') {
      return INVALID_ENTITY_TAG_LIST;
    }

    position += 1;
    const opaqueStart = position;

    while (position < value.length && value[position] !== '"') {
      if (!isEntityTagCharacter(value[position]!)) {
        return INVALID_ENTITY_TAG_LIST;
      }
      position += 1;
    }

    if (value[position] !== '"') {
      return INVALID_ENTITY_TAG_LIST;
    }

    tags.push({
      opaqueValue: value.slice(opaqueStart, position),
      strength: weak ? 'weak' : 'strong',
    });
    position += 1;
    skipOptionalWhitespace();

    if (position === value.length) {
      return { kind: 'tags', tags };
    }

    if (value[position] !== ',') {
      return INVALID_ENTITY_TAG_LIST;
    }

    position += 1;
    skipOptionalWhitespace();
    if (position === value.length) {
      return INVALID_ENTITY_TAG_LIST;
    }
  }

  return INVALID_ENTITY_TAG_LIST;
}

function matchesEntityTag(
  parsed: ParsedEntityTagList,
  current: EntityTag | undefined,
  comparison: EntityTag['strength'] | 'weak',
  resourceExists: boolean,
): boolean {
  if (parsed.kind === 'wildcard') {
    return resourceExists;
  }

  if (parsed.kind !== 'tags' || !current || !isValidEntityTag(current)) {
    return false;
  }

  return parsed.tags.some((requested) =>
    requested.opaqueValue === current.opaqueValue
    && (comparison === 'weak' || (requested.strength === 'strong' && current.strength === 'strong')));
}

function parseMonth(value: string): number | undefined {
  const month = HTTP_MONTHS.indexOf(value as (typeof HTTP_MONTHS)[number]);
  return month === -1 ? undefined : month;
}

function parseDecimal(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  return Number(value);
}

function parseClock(hour: string, minute: string, second: string): { hour: number; minute: number; second: number } | undefined {
  const parsedHour = parseDecimal(hour);
  const parsedMinute = parseDecimal(minute);
  const parsedSecond = parseDecimal(second);

  if (
    parsedHour === undefined
    || parsedMinute === undefined
    || parsedSecond === undefined
    || parsedHour > 23
    || parsedMinute > 59
    || parsedSecond > 59
  ) {
    return undefined;
  }

  return { hour: parsedHour, minute: parsedMinute, second: parsedSecond };
}

function createHttpDateTimestamp(
  weekday: string,
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
  weekdayNames: readonly string[],
): number | undefined {
  const parsedDay = parseDecimal(day);
  const parsedMonth = parseMonth(month);
  const parsedYear = parseDecimal(year);
  const clock = parseClock(hour, minute, second);

  if (
    parsedDay === undefined
    || parsedMonth === undefined
    || parsedYear === undefined
    || clock === undefined
    || parsedDay < 1
    || parsedDay > 31
    || !weekdayNames.includes(weekday)
  ) {
    return undefined;
  }

  const date = new Date(0);
  date.setUTCFullYear(parsedYear, parsedMonth, parsedDay);
  date.setUTCHours(clock.hour, clock.minute, clock.second, 0);

  if (
    date.getUTCFullYear() !== parsedYear
    || date.getUTCMonth() !== parsedMonth
    || date.getUTCDate() !== parsedDay
    || weekdayNames[date.getUTCDay()] !== weekday
  ) {
    return undefined;
  }

  return date.getTime();
}

/**
 * Parses one RFC HTTP-date value using the supplied RFC850 reference year.
 *
 * @internal This seam keeps two-digit RFC850 year tests deterministic.
 * @param header Raw HTTP-date header value.
 * @param referenceYear Year used to expand an RFC850 two-digit year.
 * @returns Parsed UTC timestamp in milliseconds, or `undefined` for invalid input.
 */
export function parseHttpDate(
  header: string | undefined,
  referenceYear = new Date().getUTCFullYear(),
): number | undefined {
  if (!header) {
    return undefined;
  }

  const imfFixdate = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(header);

  if (imfFixdate) {
    return createHttpDateTimestamp(
      imfFixdate[1]!,
      imfFixdate[2]!,
      imfFixdate[3]!,
      imfFixdate[4]!,
      imfFixdate[5]!,
      imfFixdate[6]!,
      imfFixdate[7]!,
      HTTP_WEEKDAYS,
    );
  }

  const rfc850 = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(header);

  if (rfc850) {
    const twoDigitYear = parseDecimal(rfc850[4]!);

    if (twoDigitYear === undefined) {
      return undefined;
    }

    let year = Math.floor(referenceYear / 100) * 100 + twoDigitYear;

    if (year > referenceYear + 50) {
      year -= 100;
    }

    return createHttpDateTimestamp(
      rfc850[1]!,
      rfc850[2]!,
      rfc850[3]!,
      String(year),
      rfc850[5]!,
      rfc850[6]!,
      rfc850[7]!,
      HTTP_WEEKDAY_NAMES,
    );
  }

  const asctime = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( {1}\d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(header);

  if (!asctime) {
    return undefined;
  }

  return createHttpDateTimestamp(
    asctime[1]!,
    asctime[3]!.trim(),
    asctime[2]!,
    asctime[7]!,
    asctime[4]!,
    asctime[5]!,
    asctime[6]!,
    HTTP_WEEKDAYS,
  );
}

function normalizeLastModified(lastModified: Date | undefined): number | undefined {
  if (!lastModified || Number.isNaN(lastModified.getTime())) {
    return undefined;
  }

  return Math.floor(lastModified.getTime() / 1_000) * 1_000;
}

function isSafeMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

/**
 * Determines whether `If-Range` permits applying a requested byte range.
 *
 * A missing field permits the range. Entity-tag validation requires an exact
 * strong match; valid dates match when the selected representation has not
 * changed since that instant. All malformed or unavailable validators fall
 * back to the complete representation.
 *
 * @param request Incoming request whose `If-Range` field is evaluated.
 * @param validators Selected response validators used to match `If-Range`.
 * @returns `true` when `If-Range` is absent or matches the selected representation.
 */
export function matchesIfRange(
  request: ConditionalRequestContext['request'],
  validators: ResponseValidators | undefined,
): boolean {
  const ifRange = readFirstNonEmptyRequestHeaderValue(request, 'if-range');

  if (!ifRange) {
    return true;
  }

  const tags = parseEntityTagList(ifRange);

  if (tags.kind === 'tags' && tags.tags.length === 1) {
    const [tag] = tags.tags;
    return tag?.strength === 'strong'
      && validators?.etag?.strength === 'strong'
      && tag.opaqueValue === validators.etag.opaqueValue;
  }

  const ifRangeDate = parseHttpDate(ifRange);
  const lastModified = normalizeLastModified(validators?.lastModified);

  return ifRangeDate !== undefined
    && lastModified !== undefined
    && lastModified <= ifRangeDate;
}

/**
 * Resolve the RFC validator precedence result before the selected route executes.
 *
 * @param options Dispatcher conditional request configuration.
 * @param context Matched request and route descriptor.
 * @returns The dispatch outcome and validators to preserve in the response.
 */
export async function resolveConditionalRequest(
  options: ConditionalRequestOptions,
  context: ConditionalRequestContext,
): Promise<ConditionalRequestResult> {
  const resolution = await options.resolve(context);
  return resolveConditionalRequestRepresentation(context.request, resolution);
}

/**
 * Evaluates conditional request fields against an already selected representation.
 *
 * @param request Adapter-normalized request carrying conditional request fields.
 * @param resolution Current representation existence and validators.
 * @returns The selected conditional outcome and validators.
 */
export function resolveConditionalRequestRepresentation(
  request: ConditionalRequestContext['request'],
  resolution: Awaited<ReturnType<ConditionalRequestOptions['resolve']>>,
): ConditionalRequestResult {
  const validators = resolution.exists ? resolution.validators : undefined;
  const ifMatch = parseEntityTagList(
    readFirstNonEmptyRequestHeaderValue(request, 'if-match') ?? '',
  );

  if (ifMatch.kind !== 'invalid') {
    if (!matchesEntityTag(ifMatch, validators?.etag, 'strong', resolution.exists)) {
      return { outcome: 'precondition-failed', validators };
    }
  } else {
    const lastModified = normalizeLastModified(validators?.lastModified);
    const ifUnmodifiedSince = parseHttpDate(
      readFirstNonEmptyRequestHeaderValue(request, 'if-unmodified-since'),
    );

    if (ifUnmodifiedSince !== undefined && lastModified !== undefined && lastModified > ifUnmodifiedSince) {
      return { outcome: 'precondition-failed', validators };
    }
  }

  const ifNoneMatch = parseEntityTagList(
    readFirstNonEmptyRequestHeaderValue(request, 'if-none-match') ?? '',
  );

  if (ifNoneMatch.kind !== 'invalid') {
    if (matchesEntityTag(ifNoneMatch, validators?.etag, 'weak', resolution.exists)) {
      return {
        outcome: isSafeMethod(request.method) ? 'not-modified' : 'precondition-failed',
        validators,
      };
    }
  } else {
    const lastModified = normalizeLastModified(validators?.lastModified);
    const ifModifiedSince = parseHttpDate(
      readFirstNonEmptyRequestHeaderValue(request, 'if-modified-since'),
    );

    if (
      isSafeMethod(request.method)
      && ifModifiedSince !== undefined
      && lastModified !== undefined
      && lastModified <= ifModifiedSince
    ) {
      return { outcome: 'not-modified', validators };
    }
  }

  return { outcome: 'proceed', validators };
}

/**
 * Applies selected response validators through the portable response facade.
 *
 * @param response Mutable adapter-normalized response.
 * @param validators Current representation validators, when available.
 * @returns Nothing. The response receives only validator metadata.
 */
export function applyResponseValidators(
  response: FrameworkResponse,
  validators: ResponseValidators | undefined,
): void {
  if (validators?.etag && isValidEntityTag(validators.etag)) {
    response.setHeader('ETag', formatEntityTag(validators.etag));
  }

  const lastModified = normalizeLastModified(validators?.lastModified);

  if (lastModified !== undefined) {
    response.setHeader('Last-Modified', new Date(lastModified).toUTCString());
  }
}

/**
 * Writes a bodyless conditional response through every supported adapter facade.
 *
 * @param response Mutable adapter-normalized response.
 * @param outcome Selected non-proceed conditional request outcome.
 * @param validators Current representation validators.
 * @param options Optional adapter response-write controls.
 * @returns A promise that settles after the adapter accepts the bodyless response.
 */
export async function writeConditionalResponse(
  response: FrameworkResponse,
  outcome: Exclude<ConditionalRequestOutcome, 'proceed'>,
  validators: ResponseValidators | undefined,
  options?: FrameworkResponseSendOptions,
): Promise<void> {
  applyResponseValidators(response, validators);
  response.setStatus(outcome === 'not-modified' ? 304 : 412);
  await response.send(undefined, options);
}
