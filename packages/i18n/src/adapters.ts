import type { I18nLocale } from './types.js';
import {
  isSupportedLocale,
  isValidLocale,
  normalizeLocaleResolverResult,
  parseLocalePreferences,
} from './locale-resolution.js';

/**
 * Locale metadata resolved for a non-HTTP transport context.
 */
export interface LocaleAdapterContext {
  /** Locale selected for the active context. */
  readonly locale: I18nLocale;
  /** Optional resolver name or application-defined source that selected the locale. */
  readonly source?: string;
}

/**
 * Input shared by opt-in non-HTTP locale resolvers.
 */
export interface LocaleAdapterResolverInput<TContext> {
  /** Transport-specific context supplied by the application boundary. */
  readonly context: TContext;
  /** Supported locale allow-list. Empty or omitted lists allow any syntactically valid locale. */
  readonly supportedLocales?: readonly I18nLocale[];
  /** Default locale used when no resolver selects a supported locale. */
  readonly defaultLocale: I18nLocale;
}

/**
 * Result returned by one non-HTTP locale resolver.
 */
export interface LocaleAdapterResolverResult {
  /** Locale selected by the resolver. */
  readonly locale: I18nLocale;
  /** Resolver name or application-defined source that selected the locale. */
  readonly source?: string;
}

/**
 * Explicit locale resolver used by `resolveLocale(...)` in application-defined order.
 */
export type LocaleAdapterResolver<TContext> = (input: LocaleAdapterResolverInput<TContext>) => unknown;

/**
 * Adapter-owned locale metadata store for transport contexts that have session, socket, call, or request state.
 */
export interface LocaleAdapterStore<TContext> {
  /** Reads previously stored locale metadata from the context. */
  get(context: TContext): LocaleAdapterContext | undefined;
  /** Stores locale metadata on or alongside the context. */
  set(context: TContext, locale: LocaleAdapterContext): void;
}

/**
 * Options for resolving a locale from an ordered non-HTTP resolver chain.
 */
export interface ResolveLocaleOptions<TContext> {
  /** Supported locale allow-list. Empty or omitted lists allow any syntactically valid locale. */
  readonly supportedLocales?: readonly I18nLocale[];
  /** Default locale returned when no resolver selects a supported locale. */
  readonly defaultLocale: I18nLocale;
  /** Resolver chain executed in array order. */
  readonly resolvers?: readonly LocaleAdapterResolver<TContext>[];
}

/**
 * Options for resolving and storing a locale in a transport-local store.
 */
export interface BindLocaleOptions<TContext> extends ResolveLocaleOptions<TContext> {
  /** Store used to persist the selected locale metadata for the active context. */
  readonly store: LocaleAdapterStore<TContext>;
}

/**
 * Options for creating an `Accept-Language`-style header resolver without importing HTTP types.
 */
export interface HeaderLocaleResolverOptions<TContext> {
  /** Reads the relevant header value from a WebSocket handshake, gRPC metadata object, or server request abstraction. */
  readonly getHeader: (context: TContext) => string | readonly string[] | undefined;
  /** Resolver source label returned with matches. Defaults to `accept-language`. */
  readonly source?: string;
}

/**
 * Options for creating a query parameter resolver.
 */
export interface QueryLocaleResolverOptions<TContext> {
  /** Reads a query value from a socket handshake, RPC metadata bag, CLI args object, or request abstraction. */
  readonly getQueryValue: (context: TContext) => string | readonly string[] | undefined;
  /** Resolver source label returned with matches. Defaults to `query`. */
  readonly source?: string;
}

/**
 * Options for creating a cookie resolver.
 */
export interface CookieLocaleResolverOptions<TContext> {
  /** Reads a cookie value from the application-provided context abstraction. */
  readonly getCookieValue: (context: TContext) => string | undefined;
  /** Resolver source label returned with matches. Defaults to `cookie`. */
  readonly source?: string;
}

/**
 * Options for creating a storage-backed resolver.
 */
export interface StorageLocaleResolverOptions<TContext> {
  /** Reads a stored locale from local storage, server session state, socket data, or CLI configuration. */
  readonly getStoredLocale: (context: TContext) => string | undefined;
  /** Resolver source label returned with matches. Defaults to `storage`. */
  readonly source?: string;
}

/**
 * Creates an in-memory per-object locale store backed by `WeakMap`.
 *
 * @returns A store suitable for socket, call, or request objects without mutating them.
 */
export function createWeakMapLocaleStore<TContext extends object>(): LocaleAdapterStore<TContext> {
  const locales = new WeakMap<TContext, LocaleAdapterContext>();

  return {
    get(context) {
      return locales.get(context);
    },
    set(context, locale) {
      locales.set(context, Object.freeze({ ...locale }));
    },
  };
}

/**
 * Stores locale metadata through an application-provided store abstraction.
 *
 * @param store Store that owns persistence for the transport context.
 * @param context Transport context to update.
 * @param locale Locale selected for the context.
 * @param metadata Additional locale metadata such as a resolver source.
 */
export function setAdapterLocale<TContext>(
  store: LocaleAdapterStore<TContext>,
  context: TContext,
  locale: I18nLocale,
  metadata: Omit<LocaleAdapterContext, 'locale'> = {},
): void {
  store.set(context, Object.freeze({ ...metadata, locale }));
}

/**
 * Reads locale metadata from an application-provided store abstraction.
 *
 * @param store Store that owns persistence for the transport context.
 * @param context Transport context to inspect.
 * @returns Stored locale metadata, or `undefined` when the context has no locale.
 */
export function getAdapterLocale<TContext>(
  store: LocaleAdapterStore<TContext>,
  context: TContext,
): LocaleAdapterContext | undefined {
  return store.get(context);
}

/**
 * Runs an explicit non-HTTP resolver chain and returns selected locale metadata.
 *
 * @param context Transport context supplied by the application boundary.
 * @param options Default locale, supported locales, and ordered resolvers.
 * @returns Locale metadata selected by the first valid resolver or the configured default locale.
 * @throws {TypeError} When the configured default locale is invalid or unsupported.
 */
export function resolveLocale<TContext>(context: TContext, options: ResolveLocaleOptions<TContext>): LocaleAdapterContext {
  if (!isValidLocale(options.defaultLocale)) {
    throw new TypeError('defaultLocale must be a syntactically valid locale string.');
  }

  if (!isSupportedLocale(options.defaultLocale, options.supportedLocales)) {
    throw new TypeError('defaultLocale must be listed in supportedLocales when supportedLocales is provided.');
  }

  for (const resolver of options.resolvers ?? []) {
    const result = normalizeLocaleResolverResult(
      resolver({ context, defaultLocale: options.defaultLocale, supportedLocales: options.supportedLocales }),
    );

    if (result === undefined || !isValidLocale(result.locale) || !isSupportedLocale(result.locale, options.supportedLocales)) {
      continue;
    }

    return Object.freeze({ locale: result.locale, source: result.source });
  }

  return Object.freeze({ locale: options.defaultLocale, source: 'default' });
}

/**
 * Runs a resolver chain and stores the selected locale metadata in the provided transport-local store.
 *
 * @param context Transport context supplied by the application boundary.
 * @param options Default locale, supported locales, ordered resolvers, and metadata store.
 * @returns Stored locale metadata selected by the first valid resolver or the configured default locale.
 * @throws {TypeError} When the configured default locale is invalid or unsupported.
 */
export function bindLocale<TContext>(context: TContext, options: BindLocaleOptions<TContext>): LocaleAdapterContext {
  const resolved = resolveLocale(context, options);
  setAdapterLocale(options.store, context, resolved.locale, { source: resolved.source });
  return getAdapterLocale(options.store, context) ?? resolved;
}

/**
 * Creates a resolver that selects the first supported locale from an `Accept-Language`-style header.
 *
 * @param options Header accessor and optional source label.
 * @returns Locale resolver that remains independent of HTTP, WebSocket, gRPC, and browser APIs.
 */
export function createHeaderLocaleResolver<TContext>(
  options: HeaderLocaleResolverOptions<TContext>,
): LocaleAdapterResolver<TContext> {
  const source = options.source ?? 'accept-language';

  return ({ context, supportedLocales }) => {
    for (const preference of parseLocalePreferences(options.getHeader(context))) {
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
 * Creates a resolver that reads the first query parameter value from an application-owned abstraction.
 *
 * @param options Query accessor and optional source label.
 * @returns Locale resolver that ignores empty, invalid, and unsupported query values.
 */
export function createQueryLocaleResolver<TContext>(
  options: QueryLocaleResolverOptions<TContext>,
): LocaleAdapterResolver<TContext> {
  const source = options.source ?? 'query';

  return ({ context, supportedLocales }) => {
    const rawValue = options.getQueryValue(context);
    const locale = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    if (locale === undefined || !isValidLocale(locale) || !isSupportedLocale(locale, supportedLocales)) {
      return undefined;
    }

    return { locale, source };
  };
}

/**
 * Creates a resolver that reads locale from an application-owned cookie abstraction.
 *
 * @param options Cookie accessor and optional source label.
 * @returns Locale resolver that ignores empty, invalid, and unsupported cookie values.
 */
export function createCookieLocaleResolver<TContext>(
  options: CookieLocaleResolverOptions<TContext>,
): LocaleAdapterResolver<TContext> {
  const source = options.source ?? 'cookie';

  return ({ context, supportedLocales }) => {
    const locale = options.getCookieValue(context);

    if (locale === undefined || !isValidLocale(locale) || !isSupportedLocale(locale, supportedLocales)) {
      return undefined;
    }

    return { locale, source };
  };
}

/**
 * Creates a resolver that reads locale from storage, session, socket, call, request, or CLI configuration state.
 *
 * @param options Storage accessor and optional source label.
 * @returns Locale resolver that ignores empty, invalid, and unsupported stored values.
 */
export function createStorageLocaleResolver<TContext>(
  options: StorageLocaleResolverOptions<TContext>,
): LocaleAdapterResolver<TContext> {
  const source = options.source ?? 'storage';

  return ({ context, supportedLocales }) => {
    const locale = options.getStoredLocale(context);

    if (locale === undefined || !isValidLocale(locale) || !isSupportedLocale(locale, supportedLocales)) {
      return undefined;
    }

    return { locale, source };
  };
}
