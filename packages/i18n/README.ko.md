# @fluojs/i18n

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 프레임워크 비종속 국제화 코어 표면입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [현재 범위](#현재-범위)
- [Node Filesystem Loader](#node-filesystem-loader)
- [HTTP Locale Context Adapter](#http-locale-context-adapter)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/i18n
```

## 사용 시점

다가오는 i18n 작업을 위한 안정적인 fluo-native 패키지 경계가 필요할 때 이 패키지를 사용하세요.

- `I18nModule.forRoot(...)`를 통한 애플리케이션 수준 module registration
- explicit locale translation lookup을 제공하는 프레임워크 비종속 `I18nService`
- module 없이 사용하는 standalone `createI18n(...)` entry point
- locale-scoped message catalog, deterministic fallback resolution, interpolation, default, missing-message hook
- `@fluojs/i18n/loaders/fs`를 통한 선택적 Node-only JSON catalog loading
- explicit locale을 사용하는 standard `Intl` date/time, number, currency, percent, list, relative-time formatting helper
- `@fluojs/i18n/http`를 통한 explicit HTTP `RequestContext` locale helper
- 공유 option, catalog, locale, translation-key, error type

`@fluojs/i18n`은 의도적으로 NestJS, i18next, React, Next.js, ICU/messageformat, validation, type generation에 결합하지 않습니다. Root export는 프레임워크 비종속이고 runtime-portable하게 유지됩니다. Filesystem loading은 Node-specific `@fluojs/i18n/loaders/fs` subpath에서만 제공하며, HTTP request locale helper는 `@fluojs/i18n/http` subpath에서만 제공합니다.

## 빠른 시작

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

Standalone 사용에서는 service를 직접 생성합니다.

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

## 현재 범위

이 패키지는 root entry point에서 프레임워크 비종속 core translation engine과 작은 standard-first formatting facade를 제공하고, Node-only filesystem loading과 HTTP request locale context helper를 opt-in subpath로 제공합니다. ICU/messageformat integration, validation integration, generated key union, NestJS compatibility, React/Next.js helper, remote backend/plugin chain, watch/reload behavior, runtime-specific adapter는 이 패키지의 명시적 non-goal로 남아 있습니다.

Formatting helper는 host standard `Intl` implementation에 직접 위임합니다. Locale은 모든 formatting call에서 explicit하며, named formatter option은 `createI18n(...)` 또는 `I18nModule.forRoot(...)`를 통해 service-owned immutable snapshot으로 캡처됩니다.

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

알 수 없는 named format과 invalid formatter option shape 또는 value는 `I18N_INVALID_OPTIONS`를 throw합니다. `Intl` support, locale data, output punctuation은 host runtime을 따르며, 이 패키지는 polyfill을 설치하지 않습니다. ICU/messageformat은 core package를 dependency-free와 standard-first로 유지하기 위해 이후 optional subpath로 미룹니다.

Message catalog는 하나의 canonical locale-scoped nested tree shape를 사용합니다.

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

Key는 dot path로 resolve되므로 `app.title`은 `catalogs.en.app.title`을 읽습니다. Namespace prefixing은 두 번째 resource model 없이 같은 tree를 사용합니다. `translate('save', { locale: 'en', namespace: 'common' })`는 `common.save`를 resolve합니다.

Translation lookup은 deterministic합니다.

1. explicit per-call locale
2. 해당 locale의 configured fallback chain 또는 global fallback chain
3. configured `defaultLocale`
4. per-call `defaultValue`
5. configured `missingMessage` hook

어느 단계에서도 message가 나오지 않으면 `I18nError`가 `code: 'I18N_MISSING_MESSAGE'`로 throw됩니다. Invalid catalog, locale configuration, per-call translation options는 안정적인 `I18nError` code인 `I18N_INVALID_CATALOG`, `I18N_INVALID_LOCALE_CONFIG`, `I18N_INVALID_OPTIONS`를 throw합니다.

Module registration과 standalone creation은 caller-owned options를 저장하기 전에 snapshot으로 분리합니다. 이후 options object, catalog tree, fallback chain 또는 `supportedLocales` array를 변경해도 service가 소유한 options snapshot은 바뀌지 않습니다.

## Node Filesystem Loader

Node 애플리케이션은 dedicated subpath에서 JSON filesystem loader를 선택적으로 사용할 수 있습니다.

```ts
import { createFileSystemI18nLoader } from '@fluojs/i18n/loaders/fs';

const loader = createFileSystemI18nLoader({
  rootDir: new URL('./locales', import.meta.url).pathname,
});

const common = await loader.load('en', 'common');
```

Loader는 `${rootDir}/${locale}/${namespace}.json`을 읽고 immutable `I18nMessageTree`를 반환합니다. Namespace는 `admin/common` 같은 safe relative path segment를 사용할 수 있습니다. Locale과 namespace 값은 disk read 전에 validate되며, `.`, `..`, absolute path, empty segment, `common.json` 같은 extension-bearing name, traversal attempt는 `I18N_INVALID_LOADER_OPTIONS`로 거부됩니다. Missing file은 `I18N_MISSING_CATALOG`, malformed JSON 또는 invalid message tree shape는 `I18N_INVALID_CATALOG`를 throw합니다.

이 subpath는 Node built-in을 import하며 `@fluojs/i18n` root에서 export하지 않습니다. Bundler가 명시적으로 Node.js를 target하지 않는 한 Bun, Deno, Cloudflare Workers, browser 또는 다른 non-Node runtime-portable bundle에서 import하지 마세요.

## HTTP Locale Context Adapter

HTTP request locale helper는 `@fluojs/i18n/http` subpath에서만 제공됩니다. 따라서 root `@fluojs/i18n` entry point는 프레임워크 비종속으로 유지되며 `@fluojs/http`를 import하지 않습니다.

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

Adapter는 의도적으로 explicit합니다.

- `setHttpLocale(ctx, locale, metadata)`는 `createContextKey(...)`를 사용해 현재 `RequestContext`에 locale metadata를 저장합니다.
- `getHttpLocale(ctx)`는 global fallback 없이 metadata를 읽습니다.
- `parseAcceptLanguage(header)`는 q-value 순서로 valid `Accept-Language` range를 parse하고 invalid 또는 q=0 entry를 무시합니다.
- `createAcceptLanguageLocaleResolver(...)`는 request header에서 첫 번째 supported locale을 선택합니다.
- `resolveHttpLocale(ctx, options)`는 application-provided resolver를 배열 순서대로 실행하고 invalid 또는 unsupported resolver output을 무시하며, 아무 resolver도 match하지 않으면 `defaultLocale`을 source `default`로 저장합니다.

Wildcard `*` range는 parse되지만 자동으로 locale을 선택하지는 않습니다. Wildcard별 동작이 필요한 애플리케이션은 제공된 `Accept-Language` resolver 앞이나 뒤에 resolver를 추가할 수 있습니다.

## 공개 API

| 클래스/헬퍼 | 설명 |
|---|---|
| `I18nModule` | core i18n service surface를 등록하는 module facade입니다. |
| `I18nService` | 분리된 options/catalog snapshot을 소유하고 translation을 resolve하는 core service입니다. |
| `createI18n(options)` | module registration 없이 standalone `I18nService`를 생성합니다. |
| `I18nError` | 안정적인 error code를 가진 i18n package base error입니다. |
| `@fluojs/i18n/http` | Explicit HTTP request locale context helper와 `Accept-Language` resolver utility입니다. |

Node-only `@fluojs/i18n/loaders/fs` subpath는 `FileSystemI18nLoader`, `createFileSystemI18nLoader(options)`, `FileSystemI18nLoaderOptions`, `I18nLoader`를 export합니다.

Root package는 `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nLocale`, `I18nTranslationKey`, `I18nErrorCode`, `I18nFormatOptions`, `I18nFormatterOptions`, `I18nDateTimeFormatOptions`, `I18nNumberFormatOptions`, `I18nCurrencyFormatOptions`, `I18nListFormatOptions`, `I18nRelativeTimeFormatOptions`, `I18nNamedDateTimeFormats`, `I18nNamedNumberFormats`, `I18nNamedListFormats`, `I18nNamedRelativeTimeFormats` type도 export합니다.

## 관련 패키지

- **`@fluojs/core`**: 이 패키지가 사용하는 module metadata와 shared framework error를 제공합니다.
- **`@fluojs/config`**: module registration 및 option snapshotting convention에 가장 가까운 package layout model입니다.

## 예제 소스

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
