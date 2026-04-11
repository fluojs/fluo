# fluo new 지원 매트릭스

<p><a href="./fluo-new-support-matrix.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 페이지는 현재 `fluo new`가 실제로 스캐폴딩하는 범위와, fluo가 다른 문서에서 설명하는 더 넓은 런타임/어댑터 생태계를 구분하기 위한 기준 문서입니다.

## 현재 스타터 범위 vs 더 넓은 생태계 지원

| 표면 | 현재 상태 | `fluo new`에 실제로 연결된 항목 | 다음 단계 |
| --- | --- | --- | --- |
| **애플리케이션 스타터** | **지금 스캐폴딩됨** | `fluo new my-app` 또는 `--shape application --transport http --runtime node --platform fastify`로 생성되는 Node.js + Fastify + HTTP | 이것이 현재 기본 스타터 기준선입니다. |
| **마이크로서비스 스타터** | **지금 스캐폴딩됨** | `--shape microservice --transport tcp --runtime node --platform none`으로 생성되는 Node.js + 비HTTP 플랫폼 + TCP | 추가 transport 계열은 별도 문서에 있지만, `new`가 실제로 생성하는 runnable starter는 현재 TCP입니다. |
| **mixed 스타터** | **지금 스캐폴딩됨** | `--shape mixed --transport tcp --runtime node --platform fastify`로 생성되는 Node.js + Fastify HTTP 앱 + 연결된 TCP microservice | 이것이 현재 공개된 유일한 mixed starter 변형입니다. |
| **더 넓은 어댑터/런타임 생태계** | **문서화됨, 아직 `fluo new`에는 연결되지 않음** | `@fluojs/platform-express`, `@fluojs/platform-nodejs`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers`는 실제 패키지/런타임 경로이지만 현재 `fluo new` 스타터 선택지는 아닙니다. | 스캐폴딩 이후나 수동 구성에서 이 경로를 채택하려면 아래 런타임/패키지 문서를 사용하세요. |

## 다른 문서를 읽는 방법

- `fluo new` 문서는 스타터 계약으로 읽고, 문서화된 모든 어댑터가 이미 스타터 프리셋을 가진다고 해석하지 마세요.
- 런타임/패키지 참조 문서는 현재 스타터 매트릭스 밖에서 채택 가능한 어댑터, 플랫폼, 배포 대상을 설명하는 더 넓은 생태계 지도입니다.
- 어떤 페이지가 Express, Bun, Deno, Cloudflare Workers를 언급하더라도, 위의 세 스타터 행으로 명시적으로 되돌아오지 않는 한 이는 생태계 지원을 뜻합니다.

## 기준 출처

- `packages/cli/src/new/resolver.ts`는 현재 스캐폴딩되는 `fluo new` 매트릭스의 기준 소스입니다.
- [Package Surface](./package-surface.ko.md#canonical-runtime-package-matrix)는 더 넓은 런타임/패키지 생태계의 기준 소스입니다.
- [Bootstrap Paths](../getting-started/bootstrap-paths.ko.md), [Package Chooser](./package-chooser.ko.md), [NestJS에서 마이그레이션하기](../getting-started/migrate-from-nestjs.ko.md)는 아직 스타터 프리셋이 아닌 어댑터를 다룰 때 이 문서로 연결되어야 합니다.
