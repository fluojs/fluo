import {
  createContextKey,
  getContextValue,
  setContextValue,
  type FrameworkRequest,
  type RequestContext,
} from '@fluojs/http';

import type { I18nLocale } from './types.js';

/**
 * Locale metadata stored on a fluo HTTP request context.
 */
export interface HttpLocaleContext {
  /** Locale selected for the active request. */
  readonly locale: I18nLocale;
  /** Optional resolver name or application-defined source that selected the locale. */
  readonly source?: string;
}

/**
 * Parsed `Accept-Language` preference ordered by caller priority.
 */
export interface AcceptLanguagePreference {
  /** Locale range from the header, such as `ko-KR`, `en`, or `*`. */
  readonly locale: I18nLocale;
  /** Normalized q-value between 0 and 1. */
  readonly quality: number;
}

/**
 * Input shared by explicit HTTP locale resolvers.
 */
export interface HttpLocaleResolverInput {
  /** Current request context being resolved. */
  readonly context: RequestContext;
  /** Supported locale allow-list. Empty or omitted lists allow any syntactically valid locale. */
  readonly supportedLocales?: readonly I18nLocale[];
  /** Default locale used when no resolver selects a supported locale. */
  readonly defaultLocale: I18nLocale;
}

/**
 * Result returned by one HTTP locale resolver.
 */
export interface HttpLocaleResolverResult {
  /** Locale selected by the resolver. */
  readonly locale: I18nLocale;
  /** Resolver name or application-defined source that selected the locale. */
  readonly source?: string;
}

/**
 * Explicit locale resolver used by `resolveHttpLocale(...)` in application-defined order.
 */
export type HttpLocaleResolver = (input: HttpLocaleResolverInput) => HttpLocaleResolverResult | I18nLocale | undefined;

/**
 * Options for resolving a request locale from an ordered resolver chain.
 */
export interface ResolveHttpLocaleOptions {
  /** Supported locale allow-list. Empty or omitted lists allow any syntactically valid locale. */
  readonly supportedLocales?: readonly I18nLocale[];
  /** Default locale returned when no resolver selects a supported locale. */
  readonly defaultLocale: I18nLocale;
  /** Resolver chain executed in array order. */
  readonly resolvers?: readonly HttpLocaleResolver[];
}

/**
 * Options for creating an `Accept-Language` resolver.
 */
export interface AcceptLanguageLocaleResolverOptions {
  /** Header name to inspect. Defaults to `accept-language`. */
  readonly headerName?: string;
  /** Resolver source label returned with matches. Defaults to `accept-language`. */
  readonly source?: string;
}

/**
 * Request-context key used by `setHttpLocale(...)` and `getHttpLocale(...)`.
 */
export const HTTP_LOCALE_CONTEXT_KEY = createContextKey<HttpLocaleContext>('fluo.i18n.http.locale');

const DEFAULT_ACCEPT_LANGUAGE_SOURCE = 'accept-language';
const LOCALE_PATTERN = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

function isValidLocale(locale: string): boolean {
  return LOCALE_PATTERN.test(locale);
}

function isSupportedLocale(locale: I18nLocale, supportedLocales: readonly I18nLocale[] | undefined): boolean {
  return supportedLocales === undefined || supportedLocales.length === 0 || supportedLocales.includes(locale);
}

function readHeader(request: FrameworkRequest, headerName: string): string | string[] | undefined {
  const normalizedName = headerName.toLowerCase();

  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() === normalizedName) {
      return value as string | string[] | undefined;
    }
  }

  return undefined;
}

function normalizeResolverResult(
  result: HttpLocaleResolverResult | I18nLocale | undefined,
): HttpLocaleResolverResult | undefined {
  if (result === undefined) {
    return undefined;
  }

  if (typeof result === 'string') {
    return { locale: result };
  }

  return result;
}

/**
 * Stores locale metadata on a fluo HTTP request context.
 *
 * @param context Request context to update.
 * @param locale Locale selected for the request.
 * @param metadata Additional locale metadata such as a resolver source.
 */
export function setHttpLocale(
  context: RequestContext,
  locale: I18nLocale,
  metadata: Omit<HttpLocaleContext, 'locale'> = {},
): void {
  setContextValue(context, HTTP_LOCALE_CONTEXT_KEY, Object.freeze({ ...metadata, locale }));
}

/**
 * Reads locale metadata from a fluo HTTP request context.
 *
 * @param context Request context to inspect.
 * @returns Stored locale metadata, or `undefined` when the request has no locale.
 */
export function getHttpLocale(context: RequestContext): HttpLocaleContext | undefined {
  return getContextValue(context, HTTP_LOCALE_CONTEXT_KEY);
}

/**
 * Parses an `Accept-Language` header into quality-sorted locale preferences.
 *
 * @param header Raw header value or adapter-provided repeated header values.
 * @returns Valid language ranges ordered by descending q-value and original header order for ties.
 */
export function parseAcceptLanguage(header: string | readonly string[] | undefined): readonly AcceptLanguagePreference[] {
  const rawHeader = typeof header === 'string' ? header : header?.join(',');

  if (rawHeader === undefined || rawHeader.trim() === '') {
    return [];
  }

  const preferences: Array<AcceptLanguagePreference & { readonly index: number }> = [];

  for (const [index, rawPart] of rawHeader.split(',').entries()) {
    const [rawLocale, ...parameters] = rawPart.split(';');
    const locale = rawLocale?.trim();

    if (locale === undefined || locale === '' || (locale !== '*' && !isValidLocale(locale))) {
      continue;
    }

    let quality = 1;
    let invalidQuality = false;

    for (const parameter of parameters) {
      const [rawName, rawValue] = parameter.split('=');

      if (rawName?.trim().toLowerCase() !== 'q') {
        continue;
      }

      const value = rawValue?.trim();
      const parsed = value === undefined || value === '' ? Number.NaN : Number(value);

      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        invalidQuality = true;
        break;
      }

      quality = parsed;
    }

    if (!invalidQuality && quality > 0) {
      preferences.push({ index, locale, quality });
    }
  }

  return [...preferences]
    .sort((left, right) => right.quality - left.quality || left.index - right.index)
    .map(({ locale, quality }) => ({ locale, quality }));
}

/**
 * Creates a resolver that selects the first supported `Accept-Language` locale.
 *
 * @param options Header name and source label options.
 * @returns Locale resolver that inspects the current request headers.
 */
export function createAcceptLanguageLocaleResolver(
  options: AcceptLanguageLocaleResolverOptions = {},
): HttpLocaleResolver {
  const headerName = options.headerName ?? 'accept-language';
  const source = options.source ?? DEFAULT_ACCEPT_LANGUAGE_SOURCE;

  return ({ context, supportedLocales }) => {
    const header = readHeader(context.request, headerName);
    const preferences = parseAcceptLanguage(header);

    for (const preference of preferences) {
      if (preference.locale === '*') {
        continue;
      }

      if (isSupportedLocale(preference.locale, supportedLocales)) {
        return { locale: preference.locale, source };
      }
    }

    return undefined;
  };
}

/**
 * Runs an explicit resolver chain and stores the selected request locale.
 *
 * @param context Request context to resolve and update.
 * @param options Default locale, supported locales, and ordered resolvers.
 * @returns Stored locale metadata selected by the first valid resolver or the configured default locale.
 * @throws {TypeError} When the configured default locale is invalid or unsupported.
 */
export function resolveHttpLocale(context: RequestContext, options: ResolveHttpLocaleOptions): HttpLocaleContext {
  if (!isValidLocale(options.defaultLocale)) {
    throw new TypeError('defaultLocale must be a syntactically valid locale string.');
  }

  if (!isSupportedLocale(options.defaultLocale, options.supportedLocales)) {
    throw new TypeError('defaultLocale must be listed in supportedLocales when supportedLocales is provided.');
  }

  for (const resolver of options.resolvers ?? []) {
    const result = normalizeResolverResult(
      resolver({ context, defaultLocale: options.defaultLocale, supportedLocales: options.supportedLocales }),
    );

    if (result === undefined || !isValidLocale(result.locale) || !isSupportedLocale(result.locale, options.supportedLocales)) {
      continue;
    }

    setHttpLocale(context, result.locale, { source: result.source });
    return getHttpLocale(context) ?? { locale: result.locale, source: result.source };
  }

  setHttpLocale(context, options.defaultLocale, { source: 'default' });
  return getHttpLocale(context) ?? { locale: options.defaultLocale, source: 'default' };
}
