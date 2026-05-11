# @fluojs/i18n

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Framework-agnostic internationalization core surface for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Current Scope](#current-scope)
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
- shared option, catalog, locale, translation-key, and error types

`@fluojs/i18n` is intentionally not coupled to NestJS, i18next, React, Next.js, HTTP adapters, filesystem loaders, ICU/messageformat, validation, or type generation.

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
```

## Current Scope

This package provides the framework-agnostic core translation engine only. Request locale detection, filesystem loading, HTTP adapters, ICU/messageformat integration, validation integration, generated key unions, NestJS compatibility, React/Next.js helpers, and runtime-specific adapters remain documented non-goals for this core package.

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

## Public API

| Class/Helper | Description |
|---|---|
| `I18nModule` | Module facade for registering the core i18n service surface. |
| `I18nService` | Core service that owns detached options/catalog snapshots and resolves translations. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |

The package also exports `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nLocale`, `I18nTranslationKey`, and `I18nErrorCode` types.

## Related Packages

- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/index.test.ts`
