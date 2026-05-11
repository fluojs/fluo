# @fluojs/i18n

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Framework-agnostic internationalization core surface for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Translation](#core-translation)
- [Formatting](#formatting)
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
- standard `Intl` formatting helpers with explicit locales
- explicit HTTP `RequestContext` locale helpers through `@fluojs/i18n/http`
- shared option, catalog, locale, translation-key, and error types

`@fluojs/i18n` is intentionally not coupled to NestJS i18n, i18next, next-intl, or FormatJS. It provides a standard-first alternative that stays close to the TC39 `Intl` baseline without external dependencies.

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

1. the explicit per-call locale
2. the configured fallback chain for that locale, or the global fallback chain
3. the configured `defaultLocale`
4. the per-call `defaultValue`
5. the configured `missingMessage` hook

If none of those produce a message, `I18nError` is thrown with `code: 'I18N_MISSING_MESSAGE'`.

## Formatting

Formatting helpers delegate directly to the host standard `Intl` implementation. Locale is explicit on every formatting call, and named formatter options are captured as immutable service-owned snapshots.

```ts
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

| Export | Description |
|---|---|
| `I18nModule` | Module facade for registering the core i18n service surface. |
| `I18nService` | Core service that owns detached options/catalog snapshots and resolves translations. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |
| `@fluojs/i18n/http` | Explicit HTTP request locale context helpers and `Accept-Language` resolver utilities. |
| `@fluojs/i18n/loaders/fs` | Node-only filesystem loader utilities. |

## Post-MVP Roadmap

The following features are explicit non-goals for the initial MVP and are planned for future expansion:

- **`@fluojs/i18n/icu`**: ICU MessageFormat support for complex pluralization and gender rules.
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
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
