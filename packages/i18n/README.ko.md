# @fluojs/i18n

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 프레임워크 비종속 국제화 코어 표면입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [코어 번역](#코어-번역)
- [포맷팅](#포맷팅)
- [HTTP Locale Context Adapter](#http-locale-context-adapter)
- [Node Filesystem Loader](#node-filesystem-loader)
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
- 명시적 로케일을 사용하는 표준 `Intl` 포맷팅 헬퍼.
- `@fluojs/i18n/http`를 통한 명시적 HTTP `RequestContext` 로케일 헬퍼.
- 공유 옵션, 카탈로그, 로케일, 번역 키 및 에러 타입.

`@fluojs/i18n`은 의도적으로 NestJS i18n, i18next, next-intl, FormatJS와 결합하지 않습니다. 외부 의존성 없이 TC39 `Intl` 기준에 근접한 표준 지향적 대안을 제공합니다.

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

번역 조희는 엄격한 순서를 따릅니다.

1. 호출 시 명시된 개별 로케일.
2. 해당 로케일에 구성된 폴백 체인.
3. 구성된 글로벌 폴백 체인.
4. 구성된 `defaultLocale`.
5. 호출 시 명시된 `defaultValue`.
6. 구성된 `missingMessage` 훅.

메시지를 찾을 수 없으면 `I18N_MISSING_MESSAGE` 코드와 함께 `I18nError`가 발생합니다.

## 포맷팅

포맷팅 헬퍼는 호스트 환경의 표준 `Intl` 구현에 직접 위임합니다. 로케일은 모든 포맷팅 호출에서 명시적이며, 명명된 포맷터 옵션은 서비스 소유의 불변 스냅샷으로 캡처됩니다.

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

| Export | 설명 |
|---|---|
| `I18nModule` | DI 등록을 위한 모듈입니다. |
| `I18nService` | 번역 및 포맷팅을 위한 코어 서비스입니다. |
| `createI18n` | 독립형 서비스를 생성하기 위한 헬퍼입니다. |
| `I18nError` | 패키지 전용 에러 클래스입니다. |
| `@fluojs/i18n/http` | HTTP 로케일 유틸리티를 위한 서브패스입니다. |
| `@fluojs/i18n/loaders/fs` | Node.js 파일시스템 로딩을 위한 서브패스입니다. |

## Post-MVP 로드맵

다음 기능은 초기 MVP의 명시적 비목표이며 향후 확장이 계획되어 있습니다.

- **`@fluojs/i18n/icu`**: 복잡한 복수형 및 성별 규칙을 위한 ICU MessageFormat 지원.
- **`@fluojs/i18n/validation`**: 지역화된 에러 메시지를 위한 `@fluojs/validation`과의 통합.
- **`@fluojs/i18n/typegen`**: 타입 안전한 번역 키를 위해 카탈로그 파일에서 TypeScript 타입을 생성하는 CLI 도구.
- **Remote Loaders**: 외부 API 또는 데이터베이스에서 카탈로그를 가져오는 기능 지원.
- **Additional Transport Adapters**: WebSockets, gRPC 및 CLI 환경을 위한 로케일 처리.

## 관련 패키지


- **`@fluojs/core`**: 이 패키지가 사용하는 module metadata와 shared framework error를 제공합니다.
- **`@fluojs/config`**: module registration 및 option snapshotting convention에 가장 가까운 package layout model입니다.

## 예제 소스

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/loaders/fs.ts`
- `packages/i18n/src/http.ts`
- `packages/i18n/src/index.test.ts`
