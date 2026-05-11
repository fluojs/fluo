# @fluojs/i18n

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 프레임워크 비종속 국제화 코어 표면입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [현재 범위](#현재-범위)
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
- 공유 option, catalog, locale, translation-key, error type

`@fluojs/i18n`은 의도적으로 NestJS, i18next, React, Next.js, HTTP adapter, filesystem loader, ICU/messageformat, validation, type generation에 결합하지 않습니다.

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
```

## 현재 범위

이 패키지는 프레임워크 비종속 core translation engine만 제공합니다. Request locale detection, filesystem loading, HTTP adapter, ICU/messageformat integration, validation integration, generated key union, NestJS compatibility, React/Next.js helper, runtime-specific adapter는 core package의 명시적 non-goal로 남아 있습니다.

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

## 공개 API

| 클래스/헬퍼 | 설명 |
|---|---|
| `I18nModule` | core i18n service surface를 등록하는 module facade입니다. |
| `I18nService` | 분리된 options/catalog snapshot을 소유하고 translation을 resolve하는 core service입니다. |
| `createI18n(options)` | module registration 없이 standalone `I18nService`를 생성합니다. |
| `I18nError` | 안정적인 error code를 가진 i18n package base error입니다. |

이 패키지는 `I18nModuleOptions`, `I18nMessageCatalogs`, `I18nMessageTree`, `I18nTranslateOptions`, `I18nInterpolationValues`, `I18nMissingMessageHandler`, `I18nLocale`, `I18nTranslationKey`, `I18nErrorCode` type도 export합니다.

## 관련 패키지

- **`@fluojs/core`**: 이 패키지가 사용하는 module metadata와 shared framework error를 제공합니다.
- **`@fluojs/config`**: module registration 및 option snapshotting convention에 가장 가까운 package layout model입니다.

## 예제 소스

- `packages/i18n/src/module.ts`
- `packages/i18n/src/service.ts`
- `packages/i18n/src/index.test.ts`
