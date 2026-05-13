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

/**
 * Input passed to wildcard locale policy callbacks.
 */
export interface WildcardLocalePolicyInput {
  /** Default locale configured for the resolver chain. */
  readonly defaultLocale: I18nLocale;
  /** Supported locale allow-list supplied by the caller. */
  readonly supportedLocales?: readonly I18nLocale[];
}

/**
 * Opt-in policy for resolving an `Accept-Language: *` fallback.
 */
export type WildcardLocalePolicy =
  | 'defaultLocale'
  | 'firstSupportedLocale'
  | ((input: WildcardLocalePolicyInput) => I18nLocale | undefined);

/**
 * Options for locale policy helpers that extend `Accept-Language` matching without changing defaults.
 */
export interface AcceptLanguageLocalePolicyOptions {
  /** Optional wildcard fallback policy. Omit this to keep `*` fallback-only and non-selecting. */
  readonly wildcardLocale?: WildcardLocalePolicy;
  /** Whether regional ranges such as `en-US` may normalize to supported base locales such as `en`. Defaults to `true`. */
  readonly normalizeToSupportedLocale?: boolean;
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
  return resolveSupportedLocale(locale, supportedLocales) !== undefined;
}

/**
 * Resolves a valid locale candidate to the caller-configured supported locale spelling.
 *
 * @param locale Locale identifier to check.
 * @param supportedLocales Optional list of supported locale identifiers.
 * @returns The matching supported locale spelling, the original locale when no list is configured, or `undefined` when unsupported.
 */
export function resolveSupportedLocale(
  locale: I18nLocale,
  supportedLocales: readonly I18nLocale[] | undefined,
): I18nLocale | undefined {
  if (supportedLocales === undefined || supportedLocales.length === 0) {
    return locale;
  }

  const normalizedLocale = locale.toLowerCase();
  return supportedLocales.find((supportedLocale) => supportedLocale.toLowerCase() === normalizedLocale);
}

/**
 * Normalizes a valid locale candidate to the configured supported locale surface.
 *
 * @param locale Locale candidate from an explicit resolver or language range.
 * @param supportedLocales Optional supported locale allow-list.
 * @param allowBaseLocaleMatch Whether `en-US` may resolve to supported `en`.
 * @returns The supported locale spelling selected by the caller, or `undefined` when unsupported.
 */
export function normalizeSupportedLocale(
  locale: I18nLocale,
  supportedLocales: readonly I18nLocale[] | undefined,
  allowBaseLocaleMatch = true,
): I18nLocale | undefined {
  if (supportedLocales === undefined || supportedLocales.length === 0) {
    return locale;
  }

  const normalizedLocale = locale.toLowerCase();
  const exact = resolveSupportedLocale(locale, supportedLocales);

  if (exact !== undefined) {
    return exact;
  }

  if (!allowBaseLocaleMatch) {
    return undefined;
  }

  const localeSegments = normalizedLocale.split('-');
  while (localeSegments.length > 1) {
    localeSegments.pop();
    const parentLocale = localeSegments.join('-');
    const supportedParent = supportedLocales.find((supportedLocale) => supportedLocale.toLowerCase() === parentLocale);

    if (supportedParent !== undefined) {
      return supportedParent;
    }
  }

  return undefined;
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

function resolveWildcardLocale(
  policy: WildcardLocalePolicy,
  defaultLocale: I18nLocale,
  supportedLocales: readonly I18nLocale[] | undefined,
): I18nLocale | undefined {
  if (policy === 'defaultLocale') {
    return normalizeSupportedLocale(defaultLocale, supportedLocales, false);
  }

  if (policy === 'firstSupportedLocale') {
    return supportedLocales?.[0] ?? defaultLocale;
  }

  return policy({ defaultLocale, supportedLocales });
}

/**
 * Selects a locale from parsed `Accept-Language` preferences using opt-in policy rules.
 *
 * @param preferences Parsed header preferences ordered by q-value.
 * @param defaultLocale Default locale configured for resolver fallback.
 * @param supportedLocales Optional supported locale allow-list.
 * @param options Wildcard and normalization policy options.
 * @returns The selected supported locale, or `undefined` when no policy-selected locale matches.
 */
export function selectLocaleFromAcceptLanguagePolicy(
  preferences: readonly AcceptLanguagePreferenceInternal[],
  defaultLocale: I18nLocale,
  supportedLocales: readonly I18nLocale[] | undefined,
  options: AcceptLanguageLocalePolicyOptions = {},
): I18nLocale | undefined {
  const allowBaseLocaleMatch = options.normalizeToSupportedLocale ?? true;
  let hasWildcard = false;

  for (const preference of preferences) {
    if (preference.locale === '*') {
      hasWildcard = true;
      continue;
    }

    const normalizedLocale = normalizeSupportedLocale(preference.locale, supportedLocales, allowBaseLocaleMatch);

    if (normalizedLocale !== undefined) {
      return normalizedLocale;
    }
  }

  if (!hasWildcard || options.wildcardLocale === undefined) {
    return undefined;
  }

  const wildcardLocale = resolveWildcardLocale(options.wildcardLocale, defaultLocale, supportedLocales);

  if (wildcardLocale === undefined || !isValidLocale(wildcardLocale)) {
    return undefined;
  }

  return normalizeSupportedLocale(wildcardLocale, supportedLocales, allowBaseLocaleMatch);
}
