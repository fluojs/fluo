# @fluojs/i18n

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 프레임워크 비종속 국제화 코어 표면입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [코어 번역](#코어-번역)
- [포맷팅](#포맷팅)
- [ICU MessageFormat](#icu-messageformat)
- [HTTP Locale Context Adapter](#http-locale-context-adapter)
- [Node Filesystem Loader](#node-filesystem-loader)
- [Remote Catalog Loader](#remote-catalog-loader)
- [공개 API](#공개-api)
- [Post-MVP 로드맵](#post-mvp-로드맵)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/i18n
```

## 사용 시점

i18n 작업을 위한 안정적인 fluo-native 패키지 경계가 필요할 때 이 패키지를 사용하세요.

- `I18nModule.forRoot(...)`를 통한 애플리케이션 수준 모듈 등록.
- 명시적 로케일 번역 조회를 위한 프레임워크 비종속 `I18nService`.
- 모듈 없이 사용하는 독립형 `createI18n(...)` 진입점.
- 로케일 범위 메시지 카탈로그, 결정론적 폴백 처리, 보간법 및 누락된 메시지 훅.
- `@fluojs/i18n/icu`를 통한 선택적 ICU MessageFormat 복수형/select 포맷팅.
- 명시적 로케일을 사용하는 표준 `Intl` 포맷팅 헬퍼.
- `@fluojs/i18n/http`를 통한 명시적 HTTP `RequestContext` 로케일 헬퍼.
- `@fluojs/i18n/loaders/remote`를 통한 provider-backed remote catalog loading.
- 공유 옵션, 카탈로그, 로케일, 번역 키 및 에러 타입.

`@fluojs/i18n`은 의도적으로 NestJS i18n, i18next, next-intl와 결합하지 않습니다. Root entry point는 TC39 `Intl` 기준에 가까운 표준 지향적 대안을 제공하고, ICU MessageFormat 지원은 dedicated `@fluojs/i18n/icu` subpath에 격리됩니다.

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

## 코어 번역

`I18nService`는 결정론적인 번역 조회를 제공합니다.

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

// 보간법을 사용한 번역
const title = i18n.translate('app.title', {
  locale: 'ko',
  values: { name: 'fluo' },
});
```

### 폴백 동작

번역 조회는 엄격한 순서를 따릅니다.

1. 호출 시 명시된 개별 로케일.
2. 해당 로케일에 구성된 폴백 (`fallbackLocales` 맵 또는 글로벌 폴백 배열 중 하나).
3. 구성된 `defaultLocale`.
4. 호출 시 명시된 `defaultValue`.
5. 구성된 `missingMessage` 훅.

메시지를 찾을 수 없으면 `I18N_MISSING_MESSAGE` 코드와 함께 `I18nError`가 발생합니다.

## 포맷팅

포맷팅 헬퍼는 호스트 환경의 표준 `Intl` 구현에 직접 위임합니다. 로케일은 모든 포맷팅 호출에서 명시적이며, 명명된 포맷터 옵션은 서비스 소유의 불변 스냅샷으로 캡처됩니다.

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

ICU MessageFormat 지원은 `@fluojs/i18n/icu`에 있습니다. 따라서 root `@fluojs/i18n` entry point는 프레임워크 비종속 simple interpolation contract를 유지합니다. ICU service는 먼저 core `I18nService`를 통해 메시지를 resolve하므로 locale fallback, 호출별 `defaultValue`, missing-message hook, 호환되는 primitive 값의 `{{ name }}` interpolation을 보존합니다. 이후 resolve된 메시지를 ICU plural, select, nested MessageFormat 규칙으로 포맷합니다.

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

Invalid ICU pattern, 누락된 ICU value, string이 아닌 rich formatting result는 `I18N_INVALID_MESSAGE_FORMAT` 코드의 `I18nError`로 보고됩니다. 이 subpath는 `intl-messageformat`이 사용하는 host `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.PluralRules` 구현에 의존합니다.

## HTTP Locale Context Adapter

HTTP request locale helper는 `@fluojs/i18n/http` subpath에서만 제공됩니다. 따라서 root `@fluojs/i18n` entry point는 프레임워크 비종속으로 유지되며 `@fluojs/http`를 import하지 않습니다.

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
  // resolve된 로케일로 서비스 사용
  return i18n.translate('app.title', { locale, defaultValue: 'Welcome' });
}
```

Adapter는 의도적으로 explicit합니다:

- `setHttpLocale(ctx, locale, metadata)`는 `createContextKey(...)`를 사용해 현재 `RequestContext`에 locale metadata를 저장합니다.
- `getHttpLocale(ctx)`는 global fallback 없이 metadata를 읽습니다.
- `parseAcceptLanguage(header)`는 q-value 순서로 valid `Accept-Language` range를 parse하고 invalid 또는 q=0 entry를 무시합니다.
- `createAcceptLanguageLocaleResolver(...)`는 request header에서 첫 번째 supported locale을 선택합니다.
- `resolveHttpLocale(ctx, options)`는 application-provided resolver를 배열 순서대로 실행하고 invalid 또는 unsupported resolver output을 무시하며, 아무 resolver도 match하지 않으면 `defaultLocale`을 source `default`로 저장합니다.

Wildcard `*` range는 parse되지만 자동으로 locale을 선택하지는 않습니다. Wildcard별 동작이 필요한 애플리케이션은 제공된 `Accept-Language` resolver 앞이나 뒤에 resolver를 추가할 수 있습니다.

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

## Remote Catalog Loader

Remote catalog loading은 dedicated provider-backed subpath에서 제공합니다. 애플리케이션은 root entry point에 runtime-specific dependency를 추가하지 않고 HTTP API, object store, database 또는 다른 asynchronous catalog source를 연결할 수 있습니다.

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

Provider는 validated `locale`, `namespace`, 그리고 loader timeout과 optional per-call cancellation을 결합한 `AbortSignal`을 받습니다. Provider는 raw object message tree 또는 JSON string을 반환할 수 있습니다. `undefined`와 `null`은 missing catalog로 취급되어 `I18N_MISSING_CATALOG`를 throw합니다. Malformed JSON과 invalid message tree shape는 `I18N_INVALID_CATALOG`, provider failure는 `I18N_LOADER_FAILED`, timeout은 `I18N_LOADER_TIMEOUT`, caller cancellation은 `I18N_LOADER_ABORTED`로 보고됩니다. 반환된 catalog는 항상 detached immutable `I18nMessageTree` snapshot입니다.

Remote loader는 기본적으로 cache하지 않습니다. 모든 `load(locale, namespace)` 호출은 provider를 호출하고 그 provider result를 snapshot합니다. Memory, HTTP, CDN, database 또는 stale-while-revalidate caching이 필요한 애플리케이션은 cache invalidation이 application boundary에서 명시적으로 유지되도록 provider 내부 또는 provider wrapper에서 구현해야 합니다.

Filesystem loader와 마찬가지로 locale과 namespace 값은 provider 호출 전에 validate됩니다. Namespace는 `admin/common` 같은 safe relative path segment를 사용할 수 있습니다. `.`, `..`, absolute path, empty segment, `common.json` 같은 extension-bearing name, traversal attempt는 `I18N_INVALID_LOADER_OPTIONS`로 거부됩니다.

## 공개 API

### 코어 (@fluojs/i18n)

| Export | 설명 |
|---|---|
| `I18nModule` | DI 등록을 위한 모듈입니다. |
| `I18nService` | 번역 및 포맷팅을 위한 코어 서비스입니다. |
| `createI18n` | 독립형 서비스를 생성하기 위한 헬퍼입니다. |
| `I18nError` | 패키지 전용 에러 클래스입니다. |

**타입:** `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nMissingMessageContext`, `I18nLocale`, `I18nTranslationKey`, `I18nErrorCode`, `I18nFallbackLocales`, `I18nFormatOptions`, `I18nFormatterOptions`, `I18nDateTimeFormatOptions`, `I18nNumberFormatOptions`, `I18nCurrencyFormatOptions`, `I18nListFormatOptions`, `I18nRelativeTimeFormatOptions`, `I18nNamedDateTimeFormats`, `I18nNamedNumberFormats`, `I18nNamedListFormats`, `I18nNamedRelativeTimeFormats`.

### HTTP 어댑터 (@fluojs/i18n/http)

| Export | 설명 |
|---|---|
| `resolveHttpLocale` | `RequestContext`에서 로케일 메타데이터를 확인하고 저장합니다. |
| `getHttpLocale` | `RequestContext`에서 로케일 메타데이터를 가져옵니다. |
| `setHttpLocale` | `RequestContext`에 로케일 메타데이터를 수동으로 저장합니다. |
| `createAcceptLanguageLocaleResolver` | `Accept-Language` 헤더에 대한 리졸버를 생성합니다. |
| `parseAcceptLanguage` | `Accept-Language` 헤더를 q-value 선호도로 파싱하는 유틸리티입니다. |
| `HTTP_LOCALE_CONTEXT_KEY` | `RequestContext`에 로케일 메타데이터를 저장할 때 사용하는 컨텍스트 키입니다. |

**타입:** `HttpLocaleContext`, `HttpLocaleResolver`, `HttpLocaleResolverInput`, `HttpLocaleResolverResult`, `ResolveHttpLocaleOptions`, `AcceptLanguageLocaleResolverOptions`, `AcceptLanguagePreference`.

### ICU MessageFormat (@fluojs/i18n/icu)

| Export | 설명 |
|---|---|
| `createIcuI18n(options)` | Core lookup semantics를 보존하면서 standalone ICU MessageFormat service를 생성합니다. |
| `IcuI18nService` | `I18nService`로 메시지를 resolve한 뒤 ICU formatting을 수행하는 service입니다. |

**타입:** `I18nIcuTranslateOptions`, `I18nIcuValue`, `I18nIcuValues`.

### 파일시스템 로더 (@fluojs/i18n/loaders/fs)

| Export | 설명 |
|---|---|
| `createFileSystemI18nLoader` | Node.js JSON 파일시스템 로더를 생성합니다. |
| `FileSystemI18nLoader` | 파일시스템 로더의 클래스 구현체입니다. |

**타입:** `I18nLoader`, `FileSystemI18nLoaderOptions`.

### Remote Loader (@fluojs/i18n/loaders/remote)

| Export | 설명 |
|---|---|
| `createRemoteI18nLoader` | Provider-backed remote catalog loader를 생성합니다. |
| `RemoteI18nLoader` | Remote catalog loader의 클래스 구현체입니다. |

**타입:** `I18nLoader`, `I18nLoaderLoadOptions`, `RemoteI18nCatalogProvider`, `RemoteI18nCatalogRequest`, `RemoteI18nLoaderOptions`.

## Post-MVP 로드맵


다음 기능은 초기 MVP의 명시적 비목표이며 향후 확장이 계획되어 있습니다.

- **`@fluojs/i18n/validation`**: 지역화된 에러 메시지를 위한 `@fluojs/validation`과의 통합.
- **`@fluojs/i18n/typegen`**: 타입 안전한 번역 키를 위해 카탈로그 파일에서 TypeScript 타입을 생성하는 CLI 도구.
- **Additional Transport Adapters**: WebSockets, gRPC 및 CLI 환경을 위한 로케일 처리.

## 관련 패키지


- **`@fluojs/core`**: 이 패키지가 사용하는 module metadata와 shared framework error를 제공합니다.
- **`@fluojs/config`**: module registration 및 option snapshotting convention에 가장 가까운 package layout model입니다.

## 예제 소스

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/icu.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
- `packages/i18n/src/loaders/remote.ts`
