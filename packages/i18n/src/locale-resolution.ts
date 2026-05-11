import type { I18nLocale } from './types.js';

/**
 * Normalized locale candidate returned by HTTP or non-HTTP locale resolvers.
 */
export interface LocaleResolverCandidate {
  readonly locale: unknown;
  readonly source?: string;
}

/**
 * Parsed `Accept-Language` preference with a validated locale range and q-value.
 */
export interface AcceptLanguagePreferenceInternal {
  readonly locale: I18nLocale;
  readonly quality: number;
}

const LOCALE_PATTERN = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const ACCEPT_LANGUAGE_QVALUE_PATTERN = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Checks whether a value is a syntactically valid locale identifier for resolver input.
 *
 * @param locale Value to validate as a locale identifier.
 * @returns Whether the value is a string matching the locale grammar accepted by i18n resolvers.
 */
export function isValidLocale(locale: unknown): locale is I18nLocale {
  return typeof locale === 'string' && LOCALE_PATTERN.test(locale);
}

/**
 * Checks whether a valid locale is allowed by an optional supported-locale list.
 *
 * @param locale Locale identifier to check.
 * @param supportedLocales Optional list of supported locale identifiers.
 * @returns Whether the locale is supported, or `true` when no supported-locale list is configured.
 */
export function isSupportedLocale(locale: I18nLocale, supportedLocales: readonly I18nLocale[] | undefined): boolean {
  return supportedLocales === undefined || supportedLocales.length === 0 || supportedLocales.includes(locale);
}

/**
 * Normalizes resolver output into a locale candidate object when the output shape is supported.
 *
 * @param result Resolver output to normalize.
 * @returns A locale candidate, or `undefined` when the resolver output should be ignored.
 */
export function normalizeLocaleResolverResult(result: unknown): LocaleResolverCandidate | undefined {
  if (result === undefined) {
    return undefined;
  }

  if (typeof result === 'string') {
    return { locale: result };
  }

  if (typeof result !== 'object' || result === null || !Object.hasOwn(result, 'locale')) {
    return undefined;
  }

  const candidate = result as { readonly locale?: unknown; readonly source?: unknown };

  if (candidate.source !== undefined && typeof candidate.source !== 'string') {
    return undefined;
  }

  return { locale: candidate.locale, source: candidate.source };
}

function parseAcceptLanguageQuality(parameters: readonly string[]): number | undefined {
  let quality = 1;
  let hasQuality = false;

  for (const parameter of parameters) {
    const normalizedParameter = parameter.trim();
    const qualityMatch = /^q=(.+)$/i.exec(normalizedParameter);

    if (qualityMatch === null || hasQuality) {
      return undefined;
    }

    const [, value] = qualityMatch;

    if (value === undefined || !ACCEPT_LANGUAGE_QVALUE_PATTERN.test(value)) {
      return undefined;
    }

    hasQuality = true;
    quality = Number(value);
  }

  return quality;
}

/**
 * Parses one or more `Accept-Language` header values into sorted locale preferences.
 *
 * @param header Header value or values to parse.
 * @returns Valid preferences sorted by descending q-value and original header order.
 */
export function parseLocalePreferences(header: string | readonly string[] | undefined): readonly AcceptLanguagePreferenceInternal[] {
  const rawHeader = typeof header === 'string' ? header : header?.join(',');

  if (rawHeader === undefined || rawHeader.trim() === '') {
    return [];
  }

  const preferences: Array<AcceptLanguagePreferenceInternal & { readonly index: number }> = [];

  for (const [index, rawPart] of rawHeader.split(',').entries()) {
    const [rawLocale, ...parameters] = rawPart.split(';');
    const locale = rawLocale?.trim();

    if (locale === undefined || locale === '' || (locale !== '*' && !isValidLocale(locale))) {
      continue;
    }

    const quality = parseAcceptLanguageQuality(parameters);

    if (quality !== undefined && quality > 0) {
      preferences.push({ index, locale, quality });
    }
  }

  return [...preferences]
    .sort((left, right) => right.quality - left.quality || left.index - right.index)
    .map(({ locale, quality }) => ({ locale, quality }));
}
