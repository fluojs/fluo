# i18n ecosystem bridge decision record

<p><a href="./i18n-ecosystem-bridges.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/i18n`이 NestJS i18n, i18next, next-intl, request/validation convenience glue에 대한 first-party bridge surface를 추가해야 하는지 평가합니다.

## 결정

`@fluojs/i18n` root package는 framework-agnostic 상태를 유지합니다. Ecosystem parity 작업은 **문서와 migration guidance를 먼저** 제공하며, runtime bridge helper는 opt-in, subpath-scoped, dependency-isolated, contract test로 보호되는 경우에만 허용합니다.

이 decision record는 새 runtime subpath를 추가하지 않습니다. 현재 지원되는 first-party integration surface는 다음과 같습니다.

- `@fluojs/i18n/icu`: ICU MessageFormat formatting.
- `@fluojs/i18n/http`: HTTP `RequestContext` locale metadata.
- `@fluojs/i18n/adapters`: caller-owned non-HTTP locale resolution.
- `@fluojs/i18n/validation`: explicit validation issue localization.
- `@fluojs/i18n/loaders/fs`, `@fluojs/i18n/loaders/remote`, `@fluojs/i18n/typegen`: catalog ingestion 및 type generation.

## Bridge classification

| Ecosystem bridge | 상태 | First-party 범위 | 이동하면 안 되는 경계 |
| --- | --- | --- | --- |
| NestJS i18n parity | Documentation-first | NestJS 개념을 fluo module, explicit locale passing, `@fluojs/i18n/http`, `@fluojs/i18n/validation`에 매핑하는 migration note를 제공합니다. 향후 `@fluojs/i18n/nestjs-parity` helper는 pure catalog/config-shape conversion에 한해서 검토할 수 있습니다. | `experimentalDecorators`, `emitDecoratorMetadata`, reflection metadata, Nest container assumption, implicit request locale global을 요구하지 않습니다. |
| i18next interop | Extension point | 기존 loader와 application-owned conversion을 통한 catalog/provider interop guidance에 집중합니다. 반복 수요가 있으면 pure catalog conversion helper subpath를 검토할 수 있습니다. | Root package가 i18next에 의존하거나, i18next global instance를 mutate하거나, fluo fallback semantics를 i18next default에 맞춰 변경하지 않습니다. |
| next-intl workflows | Guidance-only for now | Frontend application과 backend fluo service 사이의 shared catalog workflow를 문서화합니다. 필요한 경우 loader/typegen으로 catalog exchange를 처리합니다. | React, Next.js routing, server component, middleware assumption을 `@fluojs/i18n` 안에 넣지 않습니다. |
| Request locale + validation convenience | Existing surfaces | Application code에서 `@fluojs/i18n/http` 또는 `@fluojs/i18n/adapters`를 `@fluojs/i18n/validation`과 조합합니다. Convenience helper는 opt-in 상태를 유지하고 validation을 HTTP-only로 만들지 않을 때만 추가합니다. | Validation localization은 선택된 locale을 계속 명시적으로 받아야 하며, request state나 global을 직접 읽으면 안 됩니다. |

## Future bridge helper acceptance criteria

Bridge helper가 guidance에서 first-party runtime surface로 승격되려면 다음 조건을 모두 만족해야 합니다.

1. `@fluojs/i18n` root export가 아니라 dedicated subpath 또는 dedicated package 아래에서 publish합니다.
2. Import-time registration side effect와 직접 `process.env` 읽기가 없습니다.
3. Dependency는 optional 또는 isolated여서 root package가 Node.js, Bun, Deno, Cloudflare Workers, browser-oriented bundle에서 portable 상태를 유지합니다.
4. README section이 runtime behavior, unsupported assumption, migration limit를 문서화합니다.
5. Regression test가 catalog conversion, locale fallback behavior, invalid input handling, dependency isolation을 다룹니다.
6. Public export는 repository TSDoc baseline을 따릅니다.
7. Behavior-changing public package release에는 적절한 Changeset을 포함합니다.

## Recommended user path

- NestJS i18n에서 migration하는 경우: `I18nModule.forRoot(...)`로 시작하고, `@fluojs/i18n/http`로 request locale을 명시적으로 bind하며, global request context에 의존하지 말고 validation 실패 뒤 `@fluojs/i18n/validation`을 사용합니다.
- i18next 또는 next-intl와 catalog를 공유하는 경우: catalog conversion을 application tooling에 두고, 결과 `I18nMessageTree`를 core service 또는 loader subpath로 load합니다.
- Third-party bridge를 만드는 경우: [Third-Party Extension Contract](../contracts/third-party-extension-contract.ko.md)를 따르고 import-time patching 대신 explicit module/config API를 노출합니다.

## Contract impact

이 decision record는 runtime behavior를 변경하지 않고 새 public export도 추가하지 않습니다. 현재 문서화된 root package limitation을 보존하면서 향후 bridge proposal을 위한 compatibility boundary를 명확히 합니다.
