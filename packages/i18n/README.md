# @fluojs/i18n

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Framework-agnostic internationalization core surface for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Current Scope](#current-scope)
- [Node Filesystem Loader](#node-filesystem-loader)
- [HTTP Locale Context Adapter](#http-locale-context-adapter)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/i18n
```

## When to Use

Use this package when you need a stable fluo-native package boundary for upcoming i18n work:

- application-level module registration through `I18nModule.forRoot(...)`
- a framework-agnostic `I18nService` for explicit-locale translation lookup
- a standalone `createI18n(...)` entry point for non-module usage
- locale-scoped message catalogs, deterministic fallback resolution, interpolation, defaults, and missing-message hooks
- optional Node-only JSON catalog loading through `@fluojs/i18n/loaders/fs`
- standard `Intl` date/time, number, currency, percent, list, and relative-time formatting helpers with explicit locales
- explicit HTTP `RequestContext` locale helpers through `@fluojs/i18n/http`
- shared option, catalog, locale, translation-key, and error types

`@fluojs/i18n` is intentionally not coupled to NestJS, i18next, React, Next.js, ICU/messageformat, validation, or type generation. The root export stays framework-agnostic and runtime-portable; filesystem loading is available only from the Node-specific `@fluojs/i18n/loaders/fs` subpath, and HTTP request locale helpers are available only from the `@fluojs/i18n/http` subpath.

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

For standalone usage, create the service directly:

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

const title = i18n.translate('app.title', {
  locale: 'ko',
  values: { name: 'fluo' },
});

const total = i18n.formatCurrency(12900, {
  currency: 'KRW',
  locale: 'ko-KR',
});
```

## Current Scope

This package provides the framework-agnostic core translation engine at the root entry point plus a small standard-first formatting facade and opt-in subpaths for Node-only filesystem loading and HTTP request locale context helpers. ICU/messageformat integration, validation integration, generated key unions, NestJS compatibility, React/Next.js helpers, remote backend/plugin chains, watch/reload behavior, and runtime-specific adapters remain documented non-goals for this package.

Formatting helpers delegate directly to the host standard `Intl` implementation. Locale is explicit on every formatting call, and named formatter options are captured through `createI18n(...)` or `I18nModule.forRoot(...)` as immutable service-owned snapshots:

```ts
const i18n = createI18n({
  defaultLocale: 'en-US',
  formats: {
    dateTime: {
      invoice: { dateStyle: 'medium', timeZone: 'UTC' },
    },
    number: {
      score: { maximumFractionDigits: 1 },
    },
    list: {
      conjunction: { style: 'long', type: 'conjunction' },
    },
    relativeTime: {
      short: { numeric: 'auto', style: 'short' },
    },
  },
});

i18n.formatDateTime(new Date('2026-05-11T00:00:00.000Z'), {
  format: 'invoice',
  locale: 'en-US',
});
i18n.formatNumber(1234.5, { format: 'score', locale: 'en-US' });
i18n.formatCurrency(12.5, { currency: 'USD', locale: 'en-US' });
i18n.formatPercent(0.125, { locale: 'en-US' });
i18n.formatList(['red', 'green', 'blue'], { format: 'conjunction', locale: 'en-US' });
i18n.formatRelativeTime(-1, 'day', { format: 'short', locale: 'en-US' });
```

Unknown named formats and invalid formatter option shapes or values throw `I18N_INVALID_OPTIONS`. `Intl` support, locale data, and output punctuation follow the host runtime; this package does not install polyfills. ICU/messageformat is deferred to a later optional subpath so the core package stays dependency-free and standard-first.

Message catalogs use one canonical locale-scoped nested tree shape:

```ts
const catalogs = {
  en: {
    common: {
      save: 'Save',
    },
    app: {
      title: 'Hello {{ name }}',
    },
  },
};
```

Keys are resolved as dot paths, so `app.title` reads `catalogs.en.app.title`. Namespace prefixing uses the same tree without a second resource model: `translate('save', { locale: 'en', namespace: 'common' })` resolves `common.save`.

Translation lookup is deterministic:

1. the explicit per-call locale
2. the configured fallback chain for that locale, or the global fallback chain
3. the configured `defaultLocale`
4. the per-call `defaultValue`
5. the configured `missingMessage` hook

If none of those produce a message, `I18nError` is thrown with `code: 'I18N_MISSING_MESSAGE'`. Invalid catalogs, locale configuration, and per-call translation options throw stable `I18nError` codes: `I18N_INVALID_CATALOG`, `I18N_INVALID_LOCALE_CONFIG`, and `I18N_INVALID_OPTIONS`.

Module registration and standalone creation snapshot caller-owned options before storing them. Later mutation of the options object, catalog trees, fallback chains, or `supportedLocales` array does not mutate the service-owned options snapshot.

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

## HTTP Locale Context Adapter

HTTP request locale helpers live only under the `@fluojs/i18n/http` subpath so the root `@fluojs/i18n` entry point remains framework-agnostic and does not import `@fluojs/http`.

```ts
import { createAcceptLanguageLocaleResolver, getHttpLocale, resolveHttpLocale } from '@fluojs/i18n/http';
import type { RequestContext } from '@fluojs/http';

const acceptLanguage = createAcceptLanguageLocaleResolver();

function bindRequestLocale(ctx: RequestContext) {
  return resolveHttpLocale(ctx, {
    defaultLocale: 'en',
    supportedLocales: ['en', 'ko'],
    resolvers: [acceptLanguage],
  });
}

function handler(ctx: RequestContext) {
  const locale = getHttpLocale(ctx)?.locale ?? 'en';
  return { locale };
}
```

The adapter is intentionally explicit:

- `setHttpLocale(ctx, locale, metadata)` stores locale metadata on the current `RequestContext` using `createContextKey(...)`.
- `getHttpLocale(ctx)` reads the metadata without falling back to globals.
- `parseAcceptLanguage(header)` parses valid `Accept-Language` ranges by q-value and ignores invalid or q=0 entries.
- `createAcceptLanguageLocaleResolver(...)` selects the first supported locale from the request header.
- `resolveHttpLocale(ctx, options)` runs application-provided resolvers in order, ignores invalid or unsupported resolver output, and stores `defaultLocale` with source `default` when nothing matches.

Wildcard `*` ranges are parsed but do not automatically select a locale. Applications that want wildcard-specific behavior can add a resolver before or after the provided `Accept-Language` resolver.

## Public API

| Class/Helper | Description |
|---|---|
| `I18nModule` | Module facade for registering the core i18n service surface. |
| `I18nService` | Core service that owns detached options/catalog snapshots and resolves translations. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |
| `@fluojs/i18n/http` | Explicit HTTP request locale context helpers and `Accept-Language` resolver utilities. |

The Node-only `@fluojs/i18n/loaders/fs` subpath exports `FileSystemI18nLoader`, `createFileSystemI18nLoader(options)`, `FileSystemI18nLoaderOptions`, and `I18nLoader`.

The root package also exports `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nLocale`, `I18nTranslationKey`, `I18nErrorCode`, `I18nFormatOptions`, `I18nFormatterOptions`, `I18nDateTimeFormatOptions`, `I18nNumberFormatOptions`, `I18nCurrencyFormatOptions`, `I18nListFormatOptions`, `I18nRelativeTimeFormatOptions`, `I18nNamedDateTimeFormats`, `I18nNamedNumberFormats`, `I18nNamedListFormats`, and `I18nNamedRelativeTimeFormats` types.

## Related Packages

- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
