# toolchain contract matrix

<p><strong><kbd>한국어</kbd></strong> <a href="./toolchain-contract-matrix.md"><kbd>English</kbd></a></p>

이 매트릭스는 fluo CLI로 생성된 애플리케이션 및 공식 예제를 위한 공개 툴체인 계약을 정의합니다. 버전 고정 및 빌드 구성의 참조로 활용하세요.

## 생성 앱 기준선

| 항목 | 계약 | 버전 / 비고 |
| --- | --- | --- |
| **TypeScript** | `v6.0+` | `strict: true`, `experimentalDecorators: false`, `module: esnext`, 생성 config는 deprecated `baseUrl` aliasing을 피함 |
| **Babel** | `v7.26+` | `@babel/plugin-proposal-decorators` (`{ version: '2023-11' }`) |
| **Vite** | `v6.2+` | 개발 번들링 및 빌드 오케스트레이션에 사용. |
| **Vitest** | `v3.0+` | 유닛 및 E2E 테스트용 표준 테스트 러너. |
| **Node.js** | `v20+` | 루트 워크스페이스와 배포 패키지 매니페스트(manifest)가 선언하는 Node 기반 어댑터의 최소 지원 런타임 기준선. Bun, Deno, Cloudflare Workers 어댑터는 패키지 메타데이터가 비-Node 런타임 계약과 일치하도록 `engines.node`를 의도적으로 생략합니다. |

## CLI 및 스캐폴딩 계약

| 목표 | 명령어 | 출력 계약 |
| --- | --- | --- |
| **프로젝트 생성 (기본 HTTP)** | `fluo new my-app` | 호환 기준선 스타터인 단일 패키지(single-package) Node.js + Fastify HTTP 앱을 생성합니다. |
| **프로젝트 생성 (명시적 HTTP)** | `fluo new my-app --shape application --transport http --runtime node --platform fastify` | 기본 HTTP 스타터와 동일한 생성 결과로 해석됩니다. |
| **프로젝트 생성 (microservice)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | 실행 가능한 단일 패키지 TCP 마이크로서비스(microservice) 스타터를 생성합니다. `--transport redis-streams`, `--transport nats`, `--transport kafka`, `--transport rabbitmq`, `--transport mqtt`, `--transport grpc`는 전송별 dependency/env/proto 구성을 갖춘 다른 shipped starter 변형을 생성합니다. `@fluojs/redis` 같은 더 넓은 패키지는 추가 `fluo new --transport` 값이 아니라 스캐폴딩 이후에 붙이는 통합 선택지로 남습니다. |
| **프로젝트 생성 (mixed)** | `fluo new my-app --shape mixed --transport tcp --runtime node --platform fastify` | Fastify HTTP 앱 하나와 연결된(attached) TCP 마이크로서비스 하나를 함께 생성하는 혼합 단일 패키지 스타터를 생성합니다. |
| **대화형 위저드 (Interactive wizard)** | TTY에서 `fluo new` 실행 | 비대화형(non-interactive) 플래그 경로와 동일한 shape-first 스키마(프로젝트 이름, shape, tooling preset, package manager, install 선택, git 선택)로 해석됩니다. |
| **리소스 생성** | `fluo g <type>` | 일관된 명명 접미사 (`.service.ts`, `.controller.ts`) 산출. |
| **진단** | `fluo inspect` | 런타임 그래프 및 타이밍 데이터를 JSON 형식으로 내보내기. |

## 명명 규칙 (CLI 출력)

| 타입 | 접미사 | 예시 |
| --- | --- | --- |
| **Controller** | `.controller.ts` | `users.controller.ts` |
| **Service** | `.service.ts` | `users.service.ts` |
| **Repository** | `.repo.ts` | `users.repo.ts` |
| **DTO (입력)** | `.request.dto.ts` | `create-user.request.dto.ts` |
| **DTO (출력)** | `.response.dto.ts` | `user.response.dto.ts` |

## 빌드 구성

fluo 생성 애플리케이션은 TC39 표준 데코레이터를 올바르게 처리하기 위해 특수한 빌드 파이프라인을 사용합니다.

1.  **변환**: Babel이 Stage 3 데코레이터 변환을 적용합니다.
2.  **번들링**: Vite가 대상 런타임에 맞게 애플리케이션을 번들링합니다.
3.  **검증**: Vitest가 동일한 데코레이터 설정으로 적합성 테스트를 실행합니다.

이 도구를 대체하는 것(예: `esbuild` 직접 사용)은 필수 데코레이터 변환을 우회할 수 있으므로 현재 지원되지 않습니다.

---

런타임 지원 세부 사항은 [package-surface.ko.md](./package-surface.ko.md)를 참조하세요.
