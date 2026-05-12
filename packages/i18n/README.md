# @fluojs/i18n

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Framework-agnostic internationalization core surface for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Translation](#core-translation)
- [Formatting](#formatting)
- [ICU MessageFormat](#icu-messageformat)
- [HTTP Locale Context Adapter](#http-locale-context-adapter)
- [Non-HTTP Locale Adapters](#non-http-locale-adapters)
- [Validation Error Localization](#validation-error-localization)
- [Node Filesystem Loader](#node-filesystem-loader)
- [Remote Catalog Loader](#remote-catalog-loader)
- [Catalog Type Generation](#catalog-type-generation)
- [Public API](#public-api)
- [Ecosystem Bridge Evaluation](#ecosystem-bridge-evaluation)
- [Post-MVP Roadmap](#post-mvp-roadmap)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/i18n
```

The root entry point depends only on `@fluojs/core`. Optional subpaths keep their integration dependencies as optional peers: install `intl-messageformat` for `@fluojs/i18n/icu`, `@fluojs/http` for `@fluojs/i18n/http`, and `@fluojs/validation` for `@fluojs/i18n/validation` when you opt into those surfaces. Existing subpath users should add those peer dependencies to their application or package manifest before upgrading to the release that includes this dependency boundary change.

## When to Use

Use this package when you need a stable fluo-native package boundary for i18n work:

- application-level module registration through `I18nModule.forRoot(...)`
- a framework-agnostic `I18nService` for explicit-locale translation lookup
- a standalone `createI18n(...)` entry point for non-module usage
- locale-scoped message catalogs, deterministic fallback resolution, interpolation, and missing-message hooks
- optional ICU MessageFormat plural/select formatting through `@fluojs/i18n/icu`
- standard `Intl` formatting helpers with explicit locales
- explicit HTTP `RequestContext` locale helpers through `@fluojs/i18n/http`
- opt-in non-HTTP locale adapters for WebSocket, gRPC, CLI, local storage, and server-request abstractions through `@fluojs/i18n/adapters`
- opt-in `@fluojs/validation` issue localization through `@fluojs/i18n/validation`
- provider-backed remote catalog loading and opt-in cache wrappers through `@fluojs/i18n/loaders/remote`
- opt-in catalog key declaration generation and typed translation helper declarations through `@fluojs/i18n/typegen`
- shared option, catalog, locale, translation-key, and error types

`@fluojs/i18n` is intentionally not coupled to NestJS i18n, i18next, or next-intl. Its root entry point provides a standard-first alternative that stays close to the TC39 `Intl` baseline, while ICU MessageFormat support is isolated behind the dedicated `@fluojs/i18n/icu` subpath.

## Quick Start

```ts
import { Module } from '@fluojs/core';
import { I18nModule } from '@fluojs/i18n';

@Module({
  imports: [
    I18nModule.forRoot({
      defaultLocale: 'en',
      supportedLocales: ['en', 'ko'],
    }),
  ],
})
class AppModule {}
```

## Core Translation

The `I18nService` provides deterministic translation lookup.

```ts
import { createI18n } from '@fluojs/i18n';

const i18n = createI18n({
  defaultLocale: 'en',
  supportedLocales: ['en', 'ko'],
  fallbackLocales: { ko: ['en'] },
  catalogs: {
    en: { app: { title: 'Hello {{ name }}' } },
    ko: { app: { title: '안녕하세요 {{ name }}' } },
  },
});

// Translation with interpolation
const title = i18n.translate('app.title', {
  locale: 'ko',
  values: { name: 'fluo' },
});
```

### Fallback Behavior

Translation lookup follows a strict order:

1. The explicit per-call locale.
2. The configured fallback for that locale (either from the `fallbackLocales` map or a global fallback array).
3. The configured `defaultLocale`.
4. The per-call `defaultValue`.
5. The configured `missingMessage` hook.

If no message is found, an `I18nError` is thrown with code `I18N_MISSING_MESSAGE`.

## Formatting

Formatting helpers delegate directly to the host standard `Intl` implementation. Locale is explicit on every formatting call, and named formatter options are captured as immutable service-owned snapshots.

```ts
import { createI18n } from '@fluojs/i18n';

const i18n = createI18n({
  defaultLocale: 'en-US',
  formats: {
    dateTime: {
      invoice: { dateStyle: 'medium', timeZone: 'UTC' },
    },
  },
});

i18n.formatDateTime(new Date(), {
  format: 'invoice',
  locale: 'en-US',
});

i18n.formatCurrency(12900, {
  currency: 'KRW',
  locale: 'ko-KR',
});
```

## ICU MessageFormat

ICU MessageFormat support lives under `@fluojs/i18n/icu` so the root `@fluojs/i18n` entry point keeps its framework-agnostic simple interpolation contract. The ICU service first resolves messages through the core `I18nService`, preserving locale fallback, per-call `defaultValue`, missing-message hooks, and `{{ name }}` interpolation for compatible primitive values. It then formats the resolved message with ICU plural, select, and nested MessageFormat rules.

```ts
import { createIcuI18n } from '@fluojs/i18n/icu';

const i18n = createIcuI18n({
  defaultLocale: 'en',
  supportedLocales: ['en', 'ko'],
  fallbackLocales: { ko: ['en'] },
  catalogs: {
    en: {
      inbox: 'Hello {{ name }}. {count, plural, =0 {No messages} one {One message} other {# messages}}.',
      invite:
        '{gender, select, female {{host} invited {count, plural, one {one guest} other {# guests}}} other {{host} invited {count, plural, one {one guest} other {# guests}}}}',
    },
  },
});

i18n.translate('inbox', {
  locale: 'ko',
  values: { count: 3, name: 'Mina' },
});
// "Hello Mina. 3 messages."
```

Invalid ICU patterns, missing ICU values, and non-string rich formatting results are reported as `I18nError` with code `I18N_INVALID_MESSAGE_FORMAT`. The subpath relies on the host `Intl.NumberFormat`, `Intl.DateTimeFormat`, and `Intl.PluralRules` implementations used by `intl-messageformat`.

## HTTP Locale Context Adapter

HTTP request locale helpers live only under the `@fluojs/i18n/http` subpath so the root `@fluojs/i18n` entry point remains framework-agnostic and does not import `@fluojs/http`.

```ts
import { createI18n } from '@fluojs/i18n';
import { createAcceptLanguageLocaleResolver, getHttpLocale, resolveHttpLocale } from '@fluojs/i18n/http';
import type { RequestContext } from '@fluojs/http';

const i18n = createI18n({
  defaultLocale: 'en',
  supportedLocales: ['en', 'ko'],
  catalogs: {
    en: { app: { title: 'Welcome' } },
  },
});

const acceptLanguage = createAcceptLanguageLocaleResolver();

async function bindRequestLocale(ctx: RequestContext) {
  return resolveHttpLocale(ctx, {
    defaultLocale: 'en',
    supportedLocales: ['en', 'ko'],
    resolvers: [acceptLanguage],
  });
}

function handler(ctx: RequestContext) {
  const locale = getHttpLocale(ctx)?.locale ?? 'en';
  // Use the service with the resolved locale
  return i18n.translate('app.title', { locale, defaultValue: 'Welcome' });
}
```

The adapter is intentionally explicit:

- `setHttpLocale(ctx, locale, metadata)` stores locale metadata on the current `RequestContext` using `createContextKey(...)`.
- `getHttpLocale(ctx)` reads the metadata without falling back to globals.
- `parseAcceptLanguage(header)` parses valid `Accept-Language` ranges by q-value and ignores invalid or q=0 entries.
- `createAcceptLanguageLocaleResolver(...)` selects the first supported locale from the request header.
- `createAcceptLanguageLocalePolicyResolver(...)` is opt-in and can normalize regional ranges such as `en-US` to supported `en` or select a wildcard fallback only after explicit supported ranges are exhausted.
- `resolveHttpLocale(ctx, options)` runs application-provided resolvers in order, ignores invalid or unsupported resolver output, and stores `defaultLocale` with source `default` when nothing matches.

Wildcard `*` ranges are parsed but do not automatically select a locale. Applications that want wildcard-specific behavior can add a resolver before or after the provided `Accept-Language` resolver.

For example, this resolver keeps explicit user ranges first, treats `*` as fallback-only, and only selects the first configured supported locale when no explicit range matches:

```ts
const acceptLanguagePolicy = createAcceptLanguageLocalePolicyResolver({
  wildcardLocale: 'firstSupportedLocale',
});
```

## Non-HTTP Locale Adapters

Non-HTTP locale helpers live under the `@fluojs/i18n/adapters` subpath. They provide resolver-order locale selection for WebSocket handshakes, gRPC metadata, CLI option objects, local storage wrappers, server sessions, and request-like abstractions without coupling the root package to browser globals, Node process state, or framework-specific transport packages.

```ts
import {
  bindLocale,
  createHeaderLocaleResolver,
  createQueryLocaleResolver,
  createWeakMapLocaleStore,
  getAdapterLocale,
} from '@fluojs/i18n/adapters';

interface SocketContext {
  readonly handshake: {
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly query: Readonly<Record<string, string | undefined>>;
  };
}

const socketLocales = createWeakMapLocaleStore<SocketContext>();

const queryLocale = createQueryLocaleResolver<SocketContext>({
  getQueryValue: (socket) => socket.handshake.query.locale,
  source: 'socket-query',
});
const headerLocale = createHeaderLocaleResolver<SocketContext>({
  getHeader: (socket) => socket.handshake.headers['accept-language'],
  source: 'socket-accept-language',
});

function bindSocketLocale(socket: SocketContext) {
  return bindLocale(socket, {
    defaultLocale: 'en',
    supportedLocales: ['en', 'ko'],
    resolvers: [queryLocale, headerLocale],
    store: socketLocales,
  });
}

function handleSocketMessage(socket: SocketContext) {
  const locale = getAdapterLocale(socketLocales, socket)?.locale ?? 'en';
  return locale;
}
```

The generic adapter contract is intentionally explicit:

- `resolveLocale(context, options)` runs application-provided resolvers in order, ignores empty, invalid, and unsupported resolver output, and returns `defaultLocale` with source `default` when nothing matches.
- `bindLocale(context, { store, ...options })` resolves a locale and stores immutable metadata in an application-provided `LocaleAdapterStore`.
- `createWeakMapLocaleStore()` provides per-object metadata storage for socket, call, session, or request objects without mutating those objects.
- `createHeaderLocaleResolver(...)` parses `Accept-Language`-style values with the same q-value and wildcard behavior as the HTTP adapter.
- `createHeaderLocalePolicyResolver(...)` provides the same opt-in regional-locale normalization and wildcard fallback policy without importing HTTP types.
- `createQueryLocaleResolver(...)`, `createCookieLocaleResolver(...)`, and `createStorageLocaleResolver(...)` read locale candidates from caller-owned abstractions and never access browser globals or framework internals.

Applications choose the context shape and accessor functions. For example, a gRPC integration can read metadata through `getHeader`, a CLI integration can read a parsed `--locale` option through `getQueryValue` or `getStoredLocale`, and a browser application can pass a safe wrapper around `localStorage` through `getStoredLocale`.

## Validation Error Localization

Validation issue localization lives under `@fluojs/i18n/validation` so the root `@fluojs/i18n` entry point stays framework-agnostic and does not change `@fluojs/validation` behavior by default. Applications opt in after validation fails by translating `ValidationIssue.message` snapshots explicitly.

```ts
import { createI18n } from '@fluojs/i18n';
import { localizeDtoValidationError } from '@fluojs/i18n/validation';
import { DefaultValidator, DtoValidationError } from '@fluojs/validation';

const i18n = createI18n({
  defaultLocale: 'en',
  supportedLocales: ['en', 'ko'],
  fallbackLocales: { ko: ['en'] },
  catalogs: {
    en: { validation: { email: { EMAIL: '{{ field }} must be a valid email address.' } } },
    ko: { validation: { email: { EMAIL: '{{ field }}에는 올바른 이메일 주소가 필요합니다.' } } },
  },
});

try {
  await new DefaultValidator().materialize(input, CreateUserDto);
} catch (error) {
  if (error instanceof DtoValidationError) {
    throw localizeDtoValidationError(i18n, error, { locale: 'ko' });
  }
  throw error;
}
```

The default key candidates are most-specific to least-specific: `source.field.code`, `field.code`, `source.code`, then `code`. The default namespace is `validation`, and callers can provide `keyPrefix`, `namespace`, or a custom `keyBuilder` to match their catalog layout. Translation values include `code`, `field`, `source`, and the original `message`. Missing translations preserve the original validation message unless `fallbackToIssueMessage: false` is set, in which case an `I18nError` with code `I18N_MISSING_MESSAGE` is thrown.

This integration is intentionally not an HTTP adapter. Request locale resolution can happen through `@fluojs/i18n/http`, CLI configuration, WebSocket session state, or any other application boundary, then the chosen locale is passed explicitly to the validation localization helper.

## Node Filesystem Loader

Node applications can opt into a JSON filesystem loader from the dedicated subpath:

```ts
import { createFileSystemI18nLoader } from '@fluojs/i18n/loaders/fs';

const loader = createFileSystemI18nLoader({
  rootDir: new URL('./locales', import.meta.url).pathname,
});

const common = await loader.load('en', 'common');
```

The loader reads `${rootDir}/${locale}/${namespace}.json` and returns an immutable `I18nMessageTree`. Namespaces may use safe relative path segments such as `admin/common`; locale and namespace values are validated before disk reads, `.`/`..`, absolute paths, empty segments, extension-bearing names such as `common.json`, and traversal attempts are rejected with `I18N_INVALID_LOADER_OPTIONS`. Missing files throw `I18N_MISSING_CATALOG`; malformed JSON or invalid message tree shapes throw `I18N_INVALID_CATALOG`.

This subpath imports Node built-ins and is not exported from `@fluojs/i18n` root. Do not import it in Bun, Deno, Cloudflare Workers, browser, or other non-Node runtime-portable bundles unless your bundler explicitly targets Node.js.

## Remote Catalog Loader

Remote catalog loading lives under a dedicated provider-backed subpath so applications can connect HTTP APIs, object stores, databases, or other asynchronous catalog sources without adding runtime-specific dependencies to the root entry point:

```ts
import { createRemoteI18nLoader } from '@fluojs/i18n/loaders/remote';

const loader = createRemoteI18nLoader({
  timeoutMs: 5_000,
  provider: async ({ locale, namespace, signal }) => {
    const response = await fetch(`https://catalog.example/${locale}/${namespace}.json`, { signal });
    if (response.status === 404) {
      return undefined;
    }
    return response.text();
  },
});

const common = await loader.load('en', 'common');
```

The provider receives the validated `locale`, `namespace`, and an `AbortSignal` that combines the loader timeout with optional per-call cancellation. Providers may return a raw object message tree or a JSON string. `undefined` and `null` are treated as missing catalogs and throw `I18N_MISSING_CATALOG`; malformed JSON and invalid message tree shapes throw `I18N_INVALID_CATALOG`; provider failures are wrapped as `I18N_LOADER_FAILED`; timeouts throw `I18N_LOADER_TIMEOUT`; caller cancellation throws `I18N_LOADER_ABORTED`. Returned catalogs are always detached immutable `I18nMessageTree` snapshots.

The remote loader never caches by default: every `load(locale, namespace)` call invokes the provider and snapshots that provider result. Applications that need memory, HTTP, CDN, database, or stale-while-revalidate caching should implement it inside the provider or in a wrapper around the provider so cache invalidation remains explicit at the application boundary.

Applications that want a first-party in-memory policy can wrap the loader explicitly. Cache entries are keyed by `(locale, namespace, version)` unless the caller provides a custom key, and `invalidate(...)` / `clear()` keep invalidation application-owned:

```ts
import { createCachedRemoteI18nLoader, createRemoteI18nLoader } from '@fluojs/i18n/loaders/remote';

const uncachedLoader = createRemoteI18nLoader({ provider: fetchCatalog });
const cachedLoader = createCachedRemoteI18nLoader({
  loader: uncachedLoader,
  ttlMs: 60_000,
  version: 'catalog-2026-05-11',
});

cachedLoader.invalidate('en', 'common');
```

Like the filesystem loader, locale and namespace values are validated before the provider is called. Namespaces may use safe relative path segments such as `admin/common`; `.`/`..`, absolute paths, empty segments, extension-bearing names such as `common.json`, and traversal attempts are rejected with `I18N_INVALID_LOADER_OPTIONS`.

## Catalog Type Generation

Catalog type generation lives under the Node-oriented `@fluojs/i18n/typegen` tooling subpath. It does not narrow `I18nService.translate(key: string, ...)`; applications can opt into generated helper types where they want type-safe translation key variables or typed translation facades.

```ts
import { generateI18nCatalogTypesFromDirectory } from '@fluojs/i18n/typegen';

const declarations = await generateI18nCatalogTypesFromDirectory({
  rootDir: new URL('./locales', import.meta.url).pathname,
});
```

The directory helper scans `${rootDir}/${locale}/**/*.json`, validates each JSON file as an `I18nMessageTree`, and emits deterministic TypeScript declaration text. Filesystem namespace paths are preserved the same way loaders receive them: `locales/en/admin/common.json` contributes namespace `admin/common`, and nested leaves become fully qualified keys such as `admin/common.dashboard.title`. This matches `I18nService.translate('dashboard.title', { namespace: 'admin/common', ... })`, which prefixes the namespace exactly before lookup.

For custom pipelines or remote catalogs, generate from in-memory message trees:

```ts
import { generateI18nCatalogTypes } from '@fluojs/i18n/typegen';

const declarations = generateI18nCatalogTypes([
  {
    locale: 'en',
    namespace: 'admin/common',
    messages: {
      dashboard: {
        title: 'Dashboard',
      },
    },
  },
]);
```

The generated declaration text includes fully qualified key unions, namespace unions, namespace-to-leaf-key maps, and opt-in typed facade types. For example, `admin/common.dashboard.title` is available as a fully qualified key, while the same message can be represented as namespace `admin/common` plus leaf key `dashboard.title` through `I18nCatalogNamespaceKey<"admin/common">`.

```ts
import type { I18nCatalogTypedService } from './generated-i18n-catalog.d.ts';

const typedI18n = {
  translate: i18n.translate.bind(i18n),
  translateInNamespace: (namespace, key, options) => i18n.translate(key, { ...options, namespace }),
} satisfies I18nCatalogTypedService;

typedI18n.translate('admin/common.dashboard.title', { locale: 'en' });
typedI18n.translateInNamespace('admin/common', 'dashboard.title', { locale: 'en' });
```

These helper declarations are type-only and application-owned. They do not add runtime wrappers, do not import framework bridges, and do not change the broad runtime `I18nService.translate(key: string, options)` signature.

Both helpers deduplicate keys across locales, sort output for stable diffs, reject invalid catalog shapes with `I18N_INVALID_CATALOG`, and reject unsafe locale or namespace paths with `I18N_INVALID_LOADER_OPTIONS`.

## Public API

### Core (@fluojs/i18n)

| Export | Description |
|---|---|
| `I18nModule` | Module facade for registering the core i18n service surface. |
| `I18nService` | Core service that owns detached options/catalog snapshots and resolves translations. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |

**Types:** `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nMissingMessageContext`, `I18nLocale`, `I18nTranslationKey`, `I18nErrorCode`, `I18nFallbackLocales`, `I18nFormatOptions`, `I18nFormatterOptions`, `I18nDateTimeFormatOptions`, `I18nNumberFormatOptions`, `I18nCurrencyFormatOptions`, `I18nListFormatOptions`, `I18nRelativeTimeFormatOptions`, `I18nNamedDateTimeFormats`, `I18nNamedNumberFormats`, `I18nNamedListFormats`, `I18nNamedRelativeTimeFormats`.

### HTTP Adapter (@fluojs/i18n/http)

| Export | Description |
|---|---|
| `resolveHttpLocale` | Resolves and stores locale metadata on the `RequestContext`. |
| `getHttpLocale` | Retrieves locale metadata from the `RequestContext`. |
| `setHttpLocale` | Manually stores locale metadata on the `RequestContext`. |
| `createAcceptLanguageLocaleResolver` | Creates a resolver for the `Accept-Language` header. |
| `createAcceptLanguageLocalePolicyResolver` | Creates an opt-in `Accept-Language` policy resolver for regional normalization and wildcard fallback handling. |
| `parseAcceptLanguage` | Utility to parse `Accept-Language` header into q-value preferences. |
| `HTTP_LOCALE_CONTEXT_KEY` | Context key used to store locale metadata on `RequestContext`. |

**Types:** `HttpLocaleContext`, `HttpLocaleResolver`, `HttpLocaleResolverInput`, `HttpLocaleResolverResult`, `ResolveHttpLocaleOptions`, `AcceptLanguageLocaleResolverOptions`, `AcceptLanguageLocalePolicyResolverOptions`, `AcceptLanguagePreference`.

### Non-HTTP Adapters (@fluojs/i18n/adapters)

| Export | Description |
|---|---|
| `resolveLocale` | Resolves locale metadata from an explicit non-HTTP resolver chain. |
| `bindLocale` | Resolves and stores locale metadata in a caller-provided adapter store. |
| `setAdapterLocale` | Manually stores locale metadata in a caller-provided adapter store. |
| `getAdapterLocale` | Retrieves locale metadata from a caller-provided adapter store. |
| `createWeakMapLocaleStore` | Creates per-object metadata storage without mutating transport contexts. |
| `createHeaderLocaleResolver` | Creates an `Accept-Language`-style resolver for caller-owned header abstractions. |
| `createHeaderLocalePolicyResolver` | Creates an opt-in header policy resolver for regional normalization and wildcard fallback handling. |
| `createQueryLocaleResolver` | Creates a resolver for query, CLI option, or request parameter abstractions. |
| `createCookieLocaleResolver` | Creates a resolver for caller-owned cookie abstractions. |
| `createStorageLocaleResolver` | Creates a resolver for local storage, server session, socket data, or CLI config abstractions. |

**Types:** `LocaleAdapterContext`, `LocaleAdapterResolver`, `LocaleAdapterResolverInput`, `LocaleAdapterResolverResult`, `LocaleAdapterStore`, `ResolveLocaleOptions`, `BindLocaleOptions`, `HeaderLocaleResolverOptions`, `HeaderLocalePolicyResolverOptions`, `QueryLocaleResolverOptions`, `CookieLocaleResolverOptions`, `StorageLocaleResolverOptions`.

### Validation Integration (@fluojs/i18n/validation)

| Export | Description |
|---|---|
| `createValidationIssueTranslationKeys(issue, keyPrefix?)` | Builds default translation key candidates from validation issue source, field path, and code. |
| `localizeValidationIssue(i18n, issue, options, index?)` | Returns a validation issue snapshot with a localized message when a candidate key resolves. |
| `localizeValidationIssues(i18n, issues, options)` | Localizes an issue list without mutating the original issues. |
| `localizeDtoValidationError(i18n, error, options)` | Creates a new `DtoValidationError` with localized issue messages. |

**Types:** `LocalizeValidationIssuesOptions`, `ValidationIssueTranslationKeyBuilder`, `ValidationIssueTranslationKeyContext`.

### ICU MessageFormat (@fluojs/i18n/icu)

| Export | Description |
|---|---|
| `createIcuI18n(options)` | Creates a standalone ICU MessageFormat service while preserving core lookup semantics. |
| `IcuI18nService` | Service that resolves messages through `I18nService` before ICU formatting. |

**Types:** `I18nIcuTranslateOptions`, `I18nIcuValue`, `I18nIcuValues`.

### Filesystem Loader (@fluojs/i18n/loaders/fs)

| Export | Description |
|---|---|
| `createFileSystemI18nLoader` | Creates a Node.js JSON filesystem loader. |
| `FileSystemI18nLoader` | Class implementation of the filesystem loader. |

**Types:** `I18nLoader`, `I18nLoaderLoadOptions`, `FileSystemI18nLoaderOptions`.

### Remote Loader (@fluojs/i18n/loaders/remote)

| Export | Description |
|---|---|
| `createRemoteI18nLoader` | Creates a provider-backed remote catalog loader. |
| `RemoteI18nLoader` | Class implementation of the remote catalog loader. |
| `createCachedRemoteI18nLoader` | Creates an opt-in in-memory cache wrapper around a remote catalog loader. |
| `CachedRemoteI18nLoader` | Cache wrapper implementation with explicit `invalidate(...)` and `clear()` controls. |

**Types:** `I18nLoader`, `I18nLoaderLoadOptions`, `RemoteI18nCatalogProvider`, `RemoteI18nCatalogRequest`, `RemoteI18nLoaderOptions`, `CachedI18nLoader`, `CachedI18nLoaderKeyInput`, `CachedI18nLoaderOptions`.

### Catalog Type Generation (@fluojs/i18n/typegen)

| Export | Description |
|---|---|
| `generateI18nCatalogTypes(inputs, options?)` | Generates deterministic TypeScript key declarations from in-memory catalog trees. |
| `generateI18nCatalogTypesFromDirectory(options)` | Reads locale/namespace JSON catalogs from disk and generates key declarations. |

**Types:** `I18nCatalogTypegenInput`, `I18nCatalogTypegenOptions`, `I18nCatalogTypegenDirectoryOptions`. Generated declaration defaults include `I18nCatalogKey`, `I18nCatalogNamespace`, `I18nCatalogKeyByNamespace`, `I18nCatalogNamespaceKey`, `I18nCatalogTypedTranslateOptions`, `I18nCatalogTypedTranslate`, and `I18nCatalogTypedService`.

## Ecosystem Bridge Evaluation

The current bridge decision is documentation-first: NestJS i18n parity, i18next interop, next-intl catalog sharing, and request-locale/validation convenience glue should be handled through migration guidance and existing opt-in subpaths before adding runtime helpers. See [i18n ecosystem bridge decision record](../../docs/reference/i18n-ecosystem-bridges.md) for the classification matrix and the acceptance criteria required before any future bridge helper can become a first-party subpath.

This preserves the root package guarantee that `@fluojs/i18n` is not coupled to NestJS i18n, i18next, next-intl, React/Next.js runtime assumptions, or HTTP-only validation localization.

## Post-MVP Roadmap

The core locale-resolution roadmap item for WebSocket, gRPC, CLI, local storage, and request-style abstractions is now available through `@fluojs/i18n/adapters`. Future transport work should stay opt-in and subpath-scoped unless a dedicated framework package owns the integration.

## Related Packages


- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.
- **`@fluojs/validation`**: Provides the opt-in validation issue contract consumed by `@fluojs/i18n/validation`.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/icu.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/adapters.ts`
- `packages/i18n/src/validation.ts`
- `packages/i18n/src/index.test.ts`
- `packages/i18n/src/loaders/remote.ts`
- `packages/i18n/src/typegen.ts`
