# toolchain contract matrix

<p><strong><kbd>한국어</kbd></strong> <a href="./toolchain-contract-matrix.md"><kbd>English</kbd></a></p>

## 생성 앱 기준선

| 항목 | 계약 | 버전 / 비고 |
| --- | --- | --- |
| **TypeScript** | `v6.0+` | `strict: true`, `experimentalDecorators: false`, `module: esnext`, 생성 config는 deprecated `baseUrl` aliasing을 피함 |
| **Babel** | `v7.26+` | 루트 워크스페이스는 `@babel/core` `^7.26.10`, `@babel/plugin-proposal-decorators` `^7.28.0`, `{ version: '2023-11' }` 구성을 고정합니다. |
| **Vite** | `v6.2+` | 루트 워크스페이스는 개발 번들링 및 빌드 오케스트레이션용 `vite` `^6.2.1`을 고정합니다. |
| **Vitest** | `v3.0+` | 루트 워크스페이스는 `vitest` `^3.0.8`을 고정하며, 패키지 로컬 설정은 주로 `^3.2.4`를 사용합니다. |
| **Node.js** | `v20+` | 루트 워크스페이스와 배포 패키지 매니페스트(manifest)가 선언하는 Node 기반 어댑터의 최소 지원 런타임 기준선. Bun, Deno, Cloudflare Workers 어댑터는 패키지 메타데이터가 비-Node 런타임 계약과 일치하도록 `engines.node`를 의도적으로 생략합니다. |

## CLI 및 스캐폴딩 계약

| 목표 | 명령어 | 출력 계약 |
| --- | --- | --- |
| **프로젝트 생성 (기본 HTTP)** | `fluo new my-app` | 호환 기준선 스타터인 단일 패키지(single-package) Node.js + Fastify HTTP 앱을 생성합니다. |
| **프로젝트 생성 (명시적 HTTP)** | `fluo new my-app --shape application --transport http --runtime node --platform fastify` | 기본 HTTP 스타터와 동일한 생성 결과로 해석됩니다. |
| **프로젝트 생성 (microservice)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | 실행 가능한 단일 패키지 TCP 마이크로서비스(microservice) 스타터를 생성합니다. `--transport redis-streams`, `--transport nats`, `--transport kafka`, `--transport rabbitmq`, `--transport mqtt`, `--transport grpc`는 전송별 dependency/env/proto 구성을 갖춘 다른 shipped starter 변형을 생성합니다. `@fluojs/redis` 같은 더 넓은 패키지는 추가 `fluo new --transport` 값이 아니라 스캐폴딩 이후에 붙이는 통합 선택지로 남습니다. |
| **프로젝트 생성 (mixed)** | `fluo new my-app --shape mixed --transport tcp --runtime node --platform fastify` | Fastify HTTP 앱 하나와 연결된(attached) TCP 마이크로서비스 하나를 함께 생성하는 혼합 단일 패키지 스타터를 생성합니다. |
| **대화형 위저드 (Interactive wizard)** | TTY에서 `fluo new` 실행 | 비대화형(non-interactive) 플래그 경로와 동일한 shape-first 스키마(프로젝트 이름, shape, tooling preset, package manager, install 선택, git 선택)로 해석됩니다. |
| **리소스 생성** | `fluo g <type>` | 일관된 명명 접미사 (`.service.ts`, `.controller.ts`) 산출. Request DTO는 `fluo g req users CreateUser`처럼 명시적 feature 디렉터리를 대상으로 지정할 수 있습니다. |
| **진단 (JSON)** | `fluo inspect --json` | 런타임이 생산한 그래프, 준비성, 상태, 진단 snapshot 데이터를 JSON 형식으로 내보냅니다. `--timing`은 `--json`과 함께 사용해 bootstrap timing diagnostics를 포함할 수 있습니다. |
| **진단 report** | `fluo inspect --report --output artifacts/inspect-report.json` | 안정적인 요약, 런타임이 생산한 snapshot, diagnostics, bootstrap timing을 포함하는 CI/support triage JSON report를 씁니다. `--output <path>`는 명시적 artifact 경로이며 inspection이 애플리케이션 write를 소유하게 만들지 않습니다. |
| **진단 (Mermaid)** | `fluo inspect --mermaid` | snapshot-to-Mermaid 렌더링을 선택적 `@fluojs/studio` 계약에 위임합니다. CLI는 그래프 렌더링 의미론을 소유하지 않습니다. |

## 명명 규칙 (CLI 출력)

| 타입 | 접미사 | 예시 |
| --- | --- | --- |
| **Controller** | `.controller.ts` | `users.controller.ts` |
| **Service** | `.service.ts` | `users.service.ts` |
| **Repository** | `.repo.ts` | `users.repo.ts` |
| **DTO (입력)** | `.request.dto.ts` | `fluo g req users CreateUser`가 생성하는 `users/create-user.request.dto.ts` |
| **DTO (출력)** | `.response.dto.ts` | `user.response.dto.ts` |

## 빌드 구성

| 단계 | 도구 | 계약 |
| --- | --- | --- |
| **변환** | Babel | `@babel/plugin-proposal-decorators`와 `{ version: '2023-11' }` 구성으로 Stage 3 데코레이터 변환을 적용합니다. |
| **번들링** | Vite | 선택한 런타임 대상에 맞게 생성된 애플리케이션을 번들링합니다. |
| **검증** | Vitest | 동일한 데코레이터 구성 기준에서 테스트를 실행합니다. |
| **제약** | 대체 도구 | direct `esbuild` decorator handling 같은 대체 체인은 문서화된 지원 계약 밖에 있습니다. |

## 관련 참조

- [package-surface.ko.md](./package-surface.ko.md)
