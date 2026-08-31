import { isSupportedLocale, isValidLocale, normalizeLocaleResolverResult } from './locale-resolution.js';
import type { I18nLocale } from './types.js';

export interface LocaleResolverChainResult {
  readonly locale: I18nLocale;
  readonly source?: string;
}

export interface LocaleResolverChainOptions<TInput> {
  readonly defaultLocale: I18nLocale;
  readonly supportedLocales?: readonly I18nLocale[];
  readonly resolvers?: readonly ((input: TInput) => unknown)[];
}

export function resolveLocaleResolverChain<TInput>(
  input: TInput,
  options: LocaleResolverChainOptions<TInput>,
): LocaleResolverChainResult {
  if (!isValidLocale(options.defaultLocale)) {
    throw new TypeError('defaultLocale must be a syntactically valid locale string.');
  }

  if (!isSupportedLocale(options.defaultLocale, options.supportedLocales)) {
    throw new TypeError('defaultLocale must be listed in supportedLocales when supportedLocales is provided.');
  }

  for (const resolver of options.resolvers ?? []) {
    const result = normalizeLocaleResolverResult(resolver(input));

    if (result !== undefined && isValidLocale(result.locale) && isSupportedLocale(result.locale, options.supportedLocales)) {
      return Object.freeze({ locale: result.locale, source: result.source });
    }
  }

  return Object.freeze({ locale: options.defaultLocale, source: 'default' });
}
