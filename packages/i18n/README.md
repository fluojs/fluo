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
- a framework-agnostic `I18nService` placeholder for later translation behavior
- a standalone `createI18n(...)` entry point for non-module usage
- shared option, locale, translation-key, and error types

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

const i18n = createI18n({ defaultLocale: 'en' });
const options = i18n.snapshotOptions();
```

## Current Scope

This initial package only establishes the public package scaffold and small root API. Translation lookup, request locale detection, filesystem loading, ICU/messageformat integration, validation integration, type generation, NestJS compatibility, React/Next.js helpers, and runtime-specific adapters are documented non-goals for this scaffold.

Module registration and standalone creation snapshot caller-owned options before storing them. Later mutation of the options object or `supportedLocales` array does not mutate the service-owned options snapshot.

## Public API

| Class/Helper | Description |
|---|---|
| `I18nModule` | Module facade for registering the initial i18n service surface. |
| `I18nService` | Placeholder service that owns a detached root options snapshot. |
| `createI18n(options)` | Creates a standalone `I18nService` without module registration. |
| `I18nError` | Base i18n package error with a stable error code. |

The package also exports `I18nModuleOptions`, `I18nLocale`, `I18nTranslationKey`, and `I18nErrorCode` types.

## Related Packages

- **`@fluojs/core`**: Provides module metadata and shared framework errors used by this package.
- **`@fluojs/config`**: The closest package layout model for module registration and option snapshotting conventions.

## Example Sources

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/index.test.ts`
