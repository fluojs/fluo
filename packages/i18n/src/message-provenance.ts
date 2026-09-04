import { resolveCatalogMessage } from './catalog.js';
import type { I18nLocale, I18nMessageCatalogs } from './types.js';

export interface I18nMessageProvenance {
  readonly locale: I18nLocale;
  readonly message: string;
}

export function resolveMessageProvenance(
  catalogs: I18nMessageCatalogs | undefined,
  locales: readonly I18nLocale[],
  key: string,
): I18nMessageProvenance | undefined {
  for (const locale of locales) {
    const message = resolveCatalogMessage(catalogs?.[locale], key);

    if (message !== undefined) {
      return Object.freeze({ locale, message });
    }
  }

  return undefined;
}
