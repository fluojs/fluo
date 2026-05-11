import type { I18nLocale } from './types.js';

export interface LocaleResolverCandidate {
  readonly locale: unknown;
  readonly source?: string;
}

export interface AcceptLanguagePreferenceInternal {
  readonly locale: I18nLocale;
  readonly quality: number;
}

const LOCALE_PATTERN = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const ACCEPT_LANGUAGE_QVALUE_PATTERN = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

export function isValidLocale(locale: unknown): locale is I18nLocale {
  return typeof locale === 'string' && LOCALE_PATTERN.test(locale);
}

export function isSupportedLocale(locale: I18nLocale, supportedLocales: readonly I18nLocale[] | undefined): boolean {
  return supportedLocales === undefined || supportedLocales.length === 0 || supportedLocales.includes(locale);
}

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
