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
- [Node Filesystem Loader](#node-filesystem-loader)
- [Public API](#public-api)
- [Post-MVP Roadmap](#post-mvp-roadmap)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/i18n
```

## When to Use

Use this package when you need a stable fluo-native package boundary for i18n work:

- application-level module registration through `I18nModule.forRoot(...)`
- a framework-agnostic `I18nService` for explicit-locale translation lookup
- a standalone `createI18n(...)` entry point for non-module usage
- locale-scoped message catalogs, deterministic fallback resolution, interpolation, and missing-message hooks
- optional ICU MessageFormat plural/select formatting through `@fluojs/i18n/icu`
- standard `Intl` formatting helpers with explicit locales
- explicit HTTP `RequestContext` locale helpers through `@fluojs/i18n/http`
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
- `resolveHttpLocale(ctx, options)` runs application-provided resolvers in order, ignores invalid or unsupported resolver output, and stores `defaultLocale` with source `default` when nothing matches.

Wildcard `*` ranges are parsed but do not automatically select a locale. Applications that want wildcard-specific behavior can add a resolver before or after the provided `Accept-Language` resolver.

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
| `parseAcceptLanguage` | Utility to parse `Accept-Language` header into q-value preferences. |
| `HTTP_LOCALE_CONTEXT_KEY` | Context key used to store locale metadata on `RequestContext`. |

**Types:** `HttpLocaleContext`, `HttpLocaleResolver`, `HttpLocaleResolverInput`, `HttpLocaleResolverResult`, `ResolveHttpLocaleOptions`, `AcceptLanguageLocaleResolverOptions`, `AcceptLanguagePreference`.

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

**Types:** `I18nLoader`, `FileSystemI18nLoaderOptions`.

## Post-MVP Roadmap

The following features are explicit non-goals for the initial MVP and are planned for future expansion:

- **`@fluojs/i18n/validation`**: Integration with `@fluojs/validation` for localized error messages.
- **`@fluojs/i18n/typegen`**: CLI tools to generate TypeScript types from catalog files for type-safe translation keys.
- **Remote Loaders**: Support for fetching catalogs from external APIs or databases.
- **Additional Transport Adapters**: Locale resolution for WebSockets, gRPC, and CLI environments.

## Related Packages


- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/icu.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
