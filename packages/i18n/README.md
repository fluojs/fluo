# @fluojs/i18n

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Framework-agnostic internationalization core surface for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Current Scope](#current-scope)
- [Node Filesystem Loader](#node-filesystem-loader)
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
- shared option, catalog, locale, translation-key, and error types

`@fluojs/i18n` is intentionally not coupled to NestJS, i18next, React, Next.js, HTTP adapters, ICU/messageformat, validation, or type generation. The root export stays runtime-portable; filesystem loading is available only from the Node-specific `@fluojs/i18n/loaders/fs` subpath.

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

This package provides the framework-agnostic core translation engine plus an optional Node-only filesystem loader subpath. Request locale detection, HTTP adapters, ICU/messageformat integration, validation integration, generated key unions, NestJS compatibility, React/Next.js helpers, remote backend/plugin chains, and watch/reload behavior remain documented non-goals for this core package.

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

## Public API

| Class/Helper | Description |
|---|---|
| `I18nModule` | Module facade for registering the core i18n service surface. |
| `I18nService` | Core service that owns detached options/catalog snapshots and resolves translations. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |

The Node-only `@fluojs/i18n/loaders/fs` subpath exports `FileSystemI18nLoader`, `createFileSystemI18nLoader(options)`, `FileSystemI18nLoaderOptions`, and `I18nLoader`.

The root package also exports `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nLocale`, `I18nTranslationKey`, and `I18nErrorCode` types.

## Related Packages

- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/index.test.ts`
