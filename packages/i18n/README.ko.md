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
- [Non-HTTP Locale Adapters](#non-http-locale-adapters)
- [Validation Error Localization](#validation-error-localization)
- [Node Filesystem Loader](#node-filesystem-loader)
- [Remote Catalog Loader](#remote-catalog-loader)
- [Catalog Type Generation](#catalog-type-generation)
- [공개 API](#공개-api)
- [Ecosystem Bridge Evaluation](#ecosystem-bridge-evaluation)
- [Post-MVP 로드맵](#post-mvp-로드맵)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/i18n
```

Root entry point는 `@fluojs/core`에만 의존합니다. Optional subpath는 integration dependency를 optional peer로 유지합니다. `@fluojs/i18n/icu`를 opt-in하면 `intl-messageformat`, `@fluojs/i18n/http`를 opt-in하면 `@fluojs/http`, `@fluojs/i18n/validation`을 opt-in하면 `@fluojs/validation`을 함께 설치하세요. 기존 subpath 사용자는 이 dependency boundary 변경이 포함된 릴리스로 업그레이드하기 전에 해당 peer dependency를 application 또는 package manifest에 추가해야 합니다.

## 사용 시점

i18n 작업을 위한 안정적인 fluo-native 패키지 경계가 필요할 때 이 패키지를 사용하세요.

- `I18nModule.forRoot(...)`를 통한 애플리케이션 수준 모듈 등록.
- 명시적 로케일 번역 조회를 위한 프레임워크 비종속 `I18nService`.
- 모듈 없이 사용하는 독립형 `createI18n(...)` 진입점.
- 로케일 범위 메시지 카탈로그, 결정론적 폴백 처리, 보간법 및 누락된 메시지 훅.
- `@fluojs/i18n/icu`를 통한 선택적 ICU MessageFormat 복수형/select 포맷팅.
- 명시적 로케일을 사용하는 표준 `Intl` 포맷팅 헬퍼.
- `@fluojs/i18n/http`를 통한 명시적 HTTP `RequestContext` 로케일 헬퍼.
- `@fluojs/i18n/adapters`를 통한 WebSocket, gRPC, CLI, local storage, server-request abstraction용 opt-in non-HTTP locale adapter.
- `@fluojs/i18n/validation`을 통한 opt-in `@fluojs/validation` issue localization.
- `@fluojs/i18n/loaders/remote`를 통한 provider-backed remote catalog loading 및 opt-in cache wrapper.
- `@fluojs/i18n/typegen`을 통한 opt-in catalog key declaration generation 및 typed translation helper declaration.
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
- `createAcceptLanguageLocaleResolver(...)`는 request header에서 첫 번째 supported locale을 선택하고, language range를 case-insensitive로 match하며, match되면 configured `supportedLocales` spelling을 반환합니다.
- `createAcceptLanguageLocalePolicyResolver(...)`는 opt-in이며, `en-US` 같은 regional range를 supported `en`으로 normalize하거나 explicit supported range를 모두 확인한 뒤 wildcard fallback을 선택할 수 있습니다.
- `resolveHttpLocale(ctx, options)`는 application-provided resolver를 배열 순서대로 실행하고 invalid 또는 unsupported resolver output을 무시하며, 아무 resolver도 match하지 않으면 `defaultLocale`을 source `default`로 저장합니다.

Wildcard `*` range는 parse되지만 자동으로 locale을 선택하지는 않습니다. Wildcard별 동작이 필요한 애플리케이션은 제공된 `Accept-Language` resolver 앞이나 뒤에 resolver를 추가할 수 있습니다.

예를 들어 이 resolver는 explicit user range를 먼저 유지하고, `*`는 fallback-only로 취급하며, explicit range가 match하지 않을 때만 첫 번째 configured supported locale을 선택합니다.

```ts
const acceptLanguagePolicy = createAcceptLanguageLocalePolicyResolver({
  wildcardLocale: 'firstSupportedLocale',
});
```

## Non-HTTP Locale Adapters

Non-HTTP locale helper는 `@fluojs/i18n/adapters` subpath에서 제공합니다. WebSocket handshake, gRPC metadata, CLI option object, local storage wrapper, server session, request-like abstraction에 resolver-order locale selection을 제공하되 root package를 browser global, Node process state, framework-specific transport package와 결합하지 않습니다.

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

Generic adapter contract는 의도적으로 explicit합니다.

- `resolveLocale(context, options)`는 application-provided resolver를 배열 순서대로 실행하고 empty, invalid, unsupported resolver output을 무시하며, 아무 것도 match하지 않으면 `defaultLocale`을 source `default`로 반환합니다.
- `bindLocale(context, { store, ...options })`는 locale을 resolve한 뒤 application-provided `LocaleAdapterStore`에 immutable metadata를 저장합니다.
- `createWeakMapLocaleStore()`는 socket, call, session, request object를 mutate하지 않고 per-object metadata storage를 제공합니다.
- `createHeaderLocaleResolver(...)`는 HTTP adapter와 같은 q-value, wildcard 동작, case-insensitive matching, supported-locale spelling preservation으로 `Accept-Language` style 값을 parse합니다.
- `createHeaderLocalePolicyResolver(...)`는 HTTP type을 import하지 않고 동일한 opt-in regional-locale normalization 및 wildcard fallback policy를 제공합니다.
- `createQueryLocaleResolver(...)`, `createCookieLocaleResolver(...)`, `createStorageLocaleResolver(...)`는 caller-owned abstraction에서 locale candidate를 읽고 browser global이나 framework internal에는 접근하지 않습니다.

애플리케이션이 context shape와 accessor function을 선택합니다. 예를 들어 gRPC 통합은 `getHeader`로 metadata를 읽고, CLI 통합은 parsed `--locale` option을 `getQueryValue` 또는 `getStoredLocale`로 읽으며, browser application은 `localStorage` around safe wrapper를 `getStoredLocale`에 전달할 수 있습니다.

## Validation Error Localization

Validation issue localization은 `@fluojs/i18n/validation` subpath에서 제공합니다. 따라서 root `@fluojs/i18n` entry point는 framework-agnostic 상태를 유지하고, `@fluojs/validation` 기본 동작도 바꾸지 않습니다. 애플리케이션은 validation 실패 후 `ValidationIssue.message` snapshot을 명시적으로 번역해 opt-in합니다.

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

기본 key candidate 순서는 가장 구체적인 것부터 덜 구체적인 것까지 `source.field.code`, `field.code`, `source.code`, `code`입니다. 기본 namespace는 `validation`이고, 호출자는 catalog 구조에 맞춰 `keyPrefix`, `namespace`, 또는 custom `keyBuilder`를 제공할 수 있습니다. Translation value에는 `code`, `field`, `source`, 원래 `message`가 포함됩니다. 누락된 번역은 기본적으로 원래 validation message를 보존합니다. `fallbackToIssueMessage: false`를 설정하면 `I18N_MISSING_MESSAGE` 코드의 `I18nError`를 throw합니다.

이 통합은 의도적으로 HTTP adapter가 아닙니다. Request locale resolution은 `@fluojs/i18n/http`, CLI configuration, WebSocket session state 또는 다른 application boundary에서 처리하고, 선택된 locale을 validation localization helper에 명시적으로 전달합니다.

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

First-party in-memory policy가 필요한 애플리케이션은 loader를 명시적으로 wrap할 수 있습니다. Cache entry는 caller가 custom key를 제공하지 않는 한 `(locale, namespace, version)`으로 keying되며, `invalidate(...)` / `clear()`가 invalidation을 application-owned 상태로 유지합니다.

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

Filesystem loader와 마찬가지로 locale과 namespace 값은 provider 호출 전에 validate됩니다. Namespace는 `admin/common` 같은 safe relative path segment를 사용할 수 있습니다. `.`, `..`, absolute path, empty segment, `common.json` 같은 extension-bearing name, traversal attempt는 `I18N_INVALID_LOADER_OPTIONS`로 거부됩니다.

## Catalog Type Generation

Catalog type generation은 Node-oriented `@fluojs/i18n/typegen` tooling subpath에서 제공합니다. 이 기능은 `I18nService.translate(key: string, ...)`를 좁히지 않습니다. 애플리케이션은 type-safe translation key 변수 또는 typed translation facade가 필요한 위치에서 generated helper type을 선택적으로 사용할 수 있습니다.

```ts
import { generateI18nCatalogTypesFromDirectory } from '@fluojs/i18n/typegen';

const declarations = await generateI18nCatalogTypesFromDirectory({
  rootDir: new URL('./locales', import.meta.url).pathname,
});
```

Directory helper는 `${rootDir}/${locale}/**/*.json`을 scan하고, 각 JSON 파일을 `I18nMessageTree`로 validate한 뒤 deterministic TypeScript declaration text를 생성합니다. Filesystem namespace path는 loader가 받는 형태 그대로 보존됩니다. 예를 들어 `locales/en/admin/common.json`은 namespace `admin/common`을 제공하고, nested leaf는 `admin/common.dashboard.title` 같은 fully qualified key가 됩니다. 이는 namespace를 그대로 prefix하는 `I18nService.translate('dashboard.title', { namespace: 'admin/common', ... })` lookup과 일치합니다.

Custom pipeline 또는 remote catalog에는 in-memory message tree에서 생성할 수 있습니다.

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

Generated declaration text에는 fully qualified key union, namespace union, namespace-to-leaf-key map, opt-in typed facade type이 포함됩니다. 예를 들어 `admin/common.dashboard.title`은 fully qualified key로 사용할 수 있고, 같은 메시지는 `I18nCatalogNamespaceKey<"admin/common">`을 통해 namespace `admin/common`과 leaf key `dashboard.title` 조합으로 표현할 수 있습니다.

```ts
import type { I18nCatalogTypedService } from './generated-i18n-catalog.d.ts';

const typedI18n = {
  translate: i18n.translate.bind(i18n),
  translateInNamespace: (namespace, key, options) => i18n.translate(key, { ...options, namespace }),
} satisfies I18nCatalogTypedService;

typedI18n.translate('admin/common.dashboard.title', { locale: 'en' });
typedI18n.translateInNamespace('admin/common', 'dashboard.title', { locale: 'en' });
```

이 helper declaration은 type-only이며 application-owned입니다. Runtime wrapper를 추가하지 않고, framework bridge를 import하지 않으며, 넓은 runtime `I18nService.translate(key: string, options)` signature도 바꾸지 않습니다.

두 helper 모두 locale 간 key를 deduplicate하고 stable diff를 위해 output을 sort하며, invalid catalog shape는 `I18N_INVALID_CATALOG`, unsafe locale 또는 namespace path는 `I18N_INVALID_LOADER_OPTIONS`로 거부합니다.

## 공개 API

### 코어 (@fluojs/i18n)

| Export | 설명 |
|---|---|
| `I18nModule` | DI 등록을 위한 모듈입니다. |
| `I18nService` | Detached option/catalog snapshot을 소유하고 translation을 resolve하며 explicit-locale `Intl` formatting helper(`formatDateTime`, `formatNumber`, `formatCurrency`, `formatPercent`, `formatList`, `formatRelativeTime`)를 제공하는 core service입니다. |
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
| `createAcceptLanguageLocalePolicyResolver` | Regional normalization과 wildcard fallback handling을 위한 opt-in `Accept-Language` policy resolver를 생성합니다. |
| `parseAcceptLanguage` | `Accept-Language` 헤더를 q-value 선호도로 파싱하는 유틸리티입니다. |
| `HTTP_LOCALE_CONTEXT_KEY` | `RequestContext`에 로케일 메타데이터를 저장할 때 사용하는 컨텍스트 키입니다. |

**타입:** `HttpLocaleContext`, `HttpLocaleResolver`, `HttpLocaleResolverInput`, `HttpLocaleResolverResult`, `ResolveHttpLocaleOptions`, `AcceptLanguageLocaleResolverOptions`, `AcceptLanguageLocalePolicyResolverOptions`, `AcceptLanguagePreference`.

### Non-HTTP Adapters (@fluojs/i18n/adapters)

| Export | 설명 |
|---|---|
| `resolveLocale` | 명시적 non-HTTP resolver chain에서 locale metadata를 resolve합니다. |
| `bindLocale` | Caller-provided adapter store에 locale metadata를 resolve하고 저장합니다. |
| `setAdapterLocale` | Caller-provided adapter store에 locale metadata를 수동으로 저장합니다. |
| `getAdapterLocale` | Caller-provided adapter store에서 locale metadata를 가져옵니다. |
| `createWeakMapLocaleStore` | Transport context를 mutate하지 않는 per-object metadata storage를 생성합니다. |
| `createHeaderLocaleResolver` | Caller-owned header abstraction용 `Accept-Language` style resolver를 생성합니다. |
| `createHeaderLocalePolicyResolver` | Regional normalization과 wildcard fallback handling을 위한 opt-in header policy resolver를 생성합니다. |
| `createQueryLocaleResolver` | Query, CLI option, request parameter abstraction용 resolver를 생성합니다. |
| `createCookieLocaleResolver` | Caller-owned cookie abstraction용 resolver를 생성합니다. |
| `createStorageLocaleResolver` | Local storage, server session, socket data, CLI config abstraction용 resolver를 생성합니다. |

**타입:** `LocaleAdapterContext`, `LocaleAdapterResolver`, `LocaleAdapterResolverInput`, `LocaleAdapterResolverResult`, `LocaleAdapterStore`, `ResolveLocaleOptions`, `BindLocaleOptions`, `HeaderLocaleResolverOptions`, `HeaderLocalePolicyResolverOptions`, `QueryLocaleResolverOptions`, `CookieLocaleResolverOptions`, `StorageLocaleResolverOptions`.

### Validation Integration (@fluojs/i18n/validation)

| Export | 설명 |
|---|---|
| `createValidationIssueTranslationKeys(issue, keyPrefix?)` | validation issue source, field path, code에서 기본 translation key candidate를 생성합니다. |
| `localizeValidationIssue(i18n, issue, options, index?)` | candidate key가 resolve되면 localized message가 포함된 validation issue snapshot을 반환합니다. |
| `localizeValidationIssues(i18n, issues, options)` | 원본 issue를 mutate하지 않고 issue list를 localize합니다. |
| `localizeDtoValidationError(i18n, error, options)` | localized issue message를 가진 새 `DtoValidationError`를 생성합니다. |

**타입:** `LocalizeValidationIssuesOptions`, `ValidationIssueTranslationKeyBuilder`, `ValidationIssueTranslationKeyContext`.

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

**타입:** `I18nLoader`, `I18nLoaderLoadOptions`, `FileSystemI18nLoaderOptions`.

### Remote Loader (@fluojs/i18n/loaders/remote)

| Export | 설명 |
|---|---|
| `createRemoteI18nLoader` | Provider-backed remote catalog loader를 생성합니다. |
| `RemoteI18nLoader` | Remote catalog loader의 클래스 구현체입니다. |
| `createCachedRemoteI18nLoader` | Remote catalog loader 주변에 opt-in in-memory cache wrapper를 생성합니다. |
| `CachedRemoteI18nLoader` | Explicit `invalidate(...)`와 `clear()` control을 제공하는 cache wrapper 구현체입니다. |

**타입:** `I18nLoader`, `I18nLoaderLoadOptions`, `RemoteI18nCatalogProvider`, `RemoteI18nCatalogRequest`, `RemoteI18nLoaderOptions`, `CachedI18nLoader`, `CachedI18nLoaderKeyInput`, `CachedI18nLoaderOptions`.

### Catalog Type Generation (@fluojs/i18n/typegen)

| Export | 설명 |
|---|---|
| `generateI18nCatalogTypes(inputs, options?)` | In-memory catalog tree에서 deterministic TypeScript key declaration을 생성합니다. |
| `generateI18nCatalogTypesFromDirectory(options)` | Disk의 locale/namespace JSON catalog를 읽고 key declaration을 생성합니다. |

**타입:** `I18nCatalogTypegenInput`, `I18nCatalogTypegenOptions`, `I18nCatalogTypegenDirectoryOptions`. Generated declaration 기본값에는 `I18nCatalogKey`, `I18nCatalogNamespace`, `I18nCatalogKeyByNamespace`, `I18nCatalogNamespaceKey`, `I18nCatalogTypedTranslateOptions`, `I18nCatalogTypedTranslate`, `I18nCatalogTypedService`가 포함됩니다.

## Ecosystem Bridge Evaluation

현재 bridge decision은 documentation-first입니다. NestJS i18n parity, i18next interop, next-intl catalog sharing, request-locale/validation convenience glue는 runtime helper를 추가하기 전에 migration guidance와 기존 opt-in subpath로 처리해야 합니다. 향후 bridge helper가 first-party subpath가 되기 위해 필요한 classification matrix와 acceptance criteria는 [i18n ecosystem bridge decision record](../../docs/reference/i18n-ecosystem-bridges.ko.md)를 참조하세요.

이 결정은 `@fluojs/i18n` root package가 NestJS i18n, i18next, next-intl, React/Next.js runtime assumption, HTTP-only validation localization과 결합하지 않는다는 보장을 유지합니다.

## Post-MVP 로드맵

WebSocket, gRPC, CLI, local storage, request-style abstraction을 위한 core locale-resolution roadmap item은 이제 `@fluojs/i18n/adapters`에서 사용할 수 있습니다. 향후 transport 작업은 dedicated framework package가 통합을 소유하지 않는 한 opt-in 및 subpath-scoped 상태를 유지해야 합니다.

## 관련 패키지


- **`@fluojs/core`**: 이 패키지가 사용하는 module metadata와 shared framework error를 제공합니다.
- **`@fluojs/config`**: module registration 및 option snapshotting convention에 가장 가까운 package layout model입니다.
- **`@fluojs/validation`**: `@fluojs/i18n/validation`이 소비하는 opt-in validation issue contract를 제공합니다.

## 예제 소스

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
