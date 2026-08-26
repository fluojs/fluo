import { readFirstNonEmptyRequestHeaderValue } from '../header-helpers.js';
import type {
  ConditionalRequestOptions,
  ConditionalRequestValidators,
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
} from '../types.js';
import {
  generateEntityTag,
  matchesEntityTag,
  parseEntityTag,
  parseEntityTagList,
} from './entity-tag.js';

type ConditionalOutcome = 304 | 412;

interface ResolvedValidators {
  readonly etag?: string;
  readonly exists: boolean;
  readonly lastModified?: string;
}

/**
 * Resolve and enforce conditional request validators after normal request validation and before handler invocation.
 *
 * @param handler Matched handler about to be invoked.
 * @param requestContext Active request and response context.
 * @param options Conditional request policy configuration.
 * @returns Whether a conditional response was committed.
 */
export async function tryHandleConditionalRequestBeforeHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  options: ConditionalRequestOptions | undefined,
): Promise<boolean> {
  if (options?.resolve === undefined) {
    return false;
  }

  const configured = await options.resolve({ handler, requestContext });
  if (configured === undefined) {
    return false;
  }

  const validators = applyConfiguredValidators(requestContext.response, configured);
  if (isRetrievalRequest(requestContext.request)) {
    return false;
  }

  const outcome = evaluateConditionalRequest(
    requestContext.request,
    validators,
    requestContext.response.statusCode ?? handler.route.successStatus ?? 200,
    false,
  );

  if (outcome === undefined) {
    return false;
  }

  applyConditionalRouteHeaders(handler, requestContext.response);
  return await writeConditionalOutcome(requestContext.response, outcome);
}

/**
 * Generate response validators and enforce retrieval preconditions for a completed successful representation.
 *
 * @param request Incoming framework request.
 * @param response Response receiving validator metadata.
 * @param value Serialized response value used to generate an entity tag.
 * @param options Conditional request policy configuration.
 * @param isSerialized Whether `value` is already the formatter-selected representation.
 * @returns Whether a conditional response was committed.
 */
export async function tryHandleConditionalResponse(
  request: FrameworkRequest,
  response: FrameworkResponse,
  value: unknown,
  options: ConditionalRequestOptions | undefined,
  isSerialized = false,
): Promise<boolean> {
  if (options === undefined) {
    return false;
  }

  normalizeLastModifiedHeader(response);
  if (response.mayAlterWireBytes === true) {
    appendVaryHeader(response, 'Accept-Encoding');
  }

  if (
    options.etag !== undefined
    && readResponseHeader(response, 'etag') === undefined
    && canGenerateEntityTag(response, value)
  ) {
    const generated = await generateEntityTag(
      value,
      readResponseHeader(response, 'content-type'),
      options.etag === 'strong' && response.mayAlterWireBytes === true ? 'weak' : options.etag,
      isSerialized,
    );

    if (generated !== undefined) {
      response.setHeader('ETag', generated);
    }
  }

  const outcome = evaluateConditionalRequest(
    request,
    readResponseValidators(response),
    response.statusCode,
    true,
  );
  return outcome === undefined ? false : await writeConditionalOutcome(response, outcome);
}

function applyConditionalRouteHeaders(handler: HandlerDescriptor, response: FrameworkResponse): void {
  for (const header of handler.route.headers ?? []) {
    response.setHeader(header.name, header.value);
  }
}

function applyConfiguredValidators(
  response: FrameworkResponse,
  validators: ConditionalRequestValidators,
): ResolvedValidators {
  if (validators.etag !== undefined) {
    replaceResponseHeader(response, 'ETag', validators.etag);
  }

  const lastModified = normalizeHttpDate(validators.lastModified);
  if (lastModified !== undefined) {
    replaceResponseHeader(response, 'Last-Modified', lastModified);
  }

  return {
    etag: readResponseHeader(response, 'etag'),
    exists: validators.exists ?? true,
    lastModified: normalizeLastModifiedHeader(response),
  };
}

function readResponseValidators(response: FrameworkResponse): ResolvedValidators {
  return {
    etag: readResponseHeader(response, 'etag'),
    exists: true,
    lastModified: normalizeLastModifiedHeader(response),
  };
}

function evaluateConditionalRequest(
  request: FrameworkRequest,
  validators: ResolvedValidators,
  unconditionalStatus: number | undefined,
  evaluateIfModifiedSince: boolean,
): ConditionalOutcome | undefined {
  const currentEntityTag = parseEntityTag(validators.etag);
  const ifMatchValue = readFirstNonEmptyRequestHeaderValue(request, 'if-match');
  const hasEligibleStatus = isConditionalStatusEligible(unconditionalStatus);

  if (ifMatchValue !== undefined) {
    const ifMatch = parseEntityTagList(ifMatchValue);
    if (
      hasEligibleStatus
      && ifMatch !== undefined
      && !matchesEntityTag(currentEntityTag, ifMatch, validators.exists, 'strong')
    ) {
      return 412;
    }
  } else {
    const ifUnmodifiedSince = parseHttpDateHeader(request, 'if-unmodified-since');
    const lastModified = parseNormalizedHttpDate(validators.lastModified);

    if (
      hasEligibleStatus
      && ifUnmodifiedSince !== undefined
      && lastModified !== undefined
      && lastModified > ifUnmodifiedSince
    ) {
      return 412;
    }
  }

  const isRetrieval = isRetrievalRequest(request);
  const ifNoneMatchValue = readFirstNonEmptyRequestHeaderValue(request, 'if-none-match');

  if (ifNoneMatchValue !== undefined) {
    const ifNoneMatch = parseEntityTagList(ifNoneMatchValue);
    if (
      hasEligibleStatus
      && ifNoneMatch !== undefined
      && matchesEntityTag(currentEntityTag, ifNoneMatch, validators.exists, 'weak')
    ) {
      return isRetrieval ? 304 : 412;
    }

    return undefined;
  }

  if (!isRetrieval || !evaluateIfModifiedSince) {
    return undefined;
  }

  const ifModifiedSince = parseHttpDateHeader(request, 'if-modified-since');
  const lastModified = parseNormalizedHttpDate(validators.lastModified);

  return (
    ifModifiedSince !== undefined
    && ifModifiedSince <= Date.now()
    && lastModified !== undefined
    && lastModified <= ifModifiedSince
    && (unconditionalStatus === 200 || unconditionalStatus === 304)
  )
    ? 304
    : undefined;
}

function isRetrievalRequest(request: FrameworkRequest): boolean {
  const method = request.method.toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function isConditionalStatusEligible(status: number | undefined): boolean {
  return status === 412 || (status !== undefined && status >= 200 && status < 300);
}

async function writeConditionalOutcome(
  response: FrameworkResponse,
  status: ConditionalOutcome,
): Promise<true> {
  removeResponseHeader(response, 'Content-Length');
  response.setStatus(status);
  await response.send(undefined);
  return true;
}

function canGenerateEntityTag(response: FrameworkResponse, value: unknown): boolean {
  const status = response.statusCode ?? 200;
  return (
    value !== undefined
    && status >= 200
    && status < 300
    && status !== 204
    && status !== 205
    && !hasNoStoreDirective(response)
  );
}

function hasNoStoreDirective(response: FrameworkResponse): boolean {
  const cacheControl = readResponseHeader(response, 'cache-control');

  return cacheControl
    ?.split(',')
    .some((directive) => directive.trim().split('=', 1)[0]?.toLowerCase() === 'no-store') === true;
}

function normalizeLastModifiedHeader(response: FrameworkResponse): string | undefined {
  const normalized = normalizeHttpDate(readResponseHeader(response, 'last-modified'));

  if (normalized !== undefined) {
    response.setHeader('Last-Modified', normalized);
  }

  return normalized;
}

function normalizeHttpDate(value: Date | number | string | undefined): string | undefined {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value ?? '');

  return Number.isFinite(timestamp)
    ? new Date(Math.floor(timestamp / 1000) * 1000).toUTCString()
    : undefined;
}

function parseHttpDateHeader(request: FrameworkRequest, name: string): number | undefined {
  return parseHttpDate(readFirstNonEmptyRequestHeaderValue(request, name));
}

function parseNormalizedHttpDate(value: string | undefined): number | undefined {
  return parseHttpDate(value);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parseHttpDate(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const imf = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  if (imf) {
    return createUtcHttpDate(imf[1], imf[2], imf[3], imf[4], imf[5], imf[6], imf[7]);
  }

  const rfc850 = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  if (rfc850) {
    const year = 2000 + Number(rfc850[4]);
    const candidate = createUtcTimestamp(rfc850[2], rfc850[3], String(year), rfc850[5], rfc850[6], rfc850[7]);
    const resolvedYear = candidate !== undefined && candidate > fiftyYearsFromNow()
      ? year - 100
      : year;
    return createUtcHttpDate(
      rfc850[1].slice(0, 3), rfc850[2], rfc850[3], String(resolvedYear), rfc850[5], rfc850[6], rfc850[7],
    );
  }

  const asctime = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: {2}([1-9])| ([12]\d|3[01])) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
  return asctime === null
    ? undefined
    : createUtcHttpDate(asctime[1], asctime[3] ?? asctime[4], asctime[2], asctime[8], asctime[5], asctime[6], asctime[7]);
}

function fiftyYearsFromNow(): number {
  const now = new Date(Date.now());
  return Date.UTC(
    now.getUTCFullYear() + 50,
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  );
}

function createUtcHttpDate(
  weekday: string,
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
): number | undefined {
  const timestamp = createUtcTimestamp(day, month, year, hour, minute, second);
  if (timestamp === undefined) {
    return undefined;
  }

  return new Date(timestamp).getUTCDay() === WEEKDAYS.indexOf(weekday as typeof WEEKDAYS[number])
    ? timestamp
    : undefined;
}

function createUtcTimestamp(
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
): number | undefined {
  const monthIndex = MONTHS.indexOf(month as typeof MONTHS[number]);
  const timestamp = Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second));
  const date = new Date(timestamp);

  return (
    monthIndex !== -1
    && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === monthIndex
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second)
    && Number.isFinite(timestamp)
  )
    ? timestamp
    : undefined;
}

function appendVaryHeader(response: FrameworkResponse, value: string): void {
  const existing = readResponseHeader(response, 'vary');
  const values = existing?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    values.push(value);
    replaceResponseHeader(response, 'Vary', values.join(', '));
  }
}

function removeResponseHeader(response: FrameworkResponse, name: string): void {
  response.removeHeader?.(name);
  for (const headerName of Object.keys(response.headers)) {
    if (headerName.toLowerCase() === name.toLowerCase()) {
      delete response.headers[headerName];
    }
  }
}

function replaceResponseHeader(response: FrameworkResponse, name: string, value: string): void {
  for (const headerName of Object.keys(response.headers)) {
    if (headerName.toLowerCase() === name.toLowerCase()) {
      delete response.headers[headerName];
    }
  }

  response.setHeader(name, value);
}

function readResponseHeader(response: FrameworkResponse, name: string): string | undefined {
  const entry = Object.entries(response.headers)
    .reverse()
    .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];

  return Array.isArray(value) ? value.join(',') : value;
}
