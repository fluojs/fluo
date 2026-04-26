# examples

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 디렉토리는 fluo의 공식 runnable example 애플리케이션을 모아 둔 곳입니다. 각 예제는 개별 README를 가지며, `../book/`의 학습 경로와 함께 읽는 것을 전제로 합니다. AI 도구이거나 계약 레퍼런스가 필요하다면 `../docs/CONTEXT.ko.md`를 출발점으로 삼으세요.

이 예제들은 생성 스캐폴드와 runnable 예제가 계속 일치하도록 의도적으로 공개된 `fluo new` v2 매트릭스의 HTTP 쪽 경로를 유지합니다. 다른 first-class 스타터 계약은 Express, raw Node.js HTTP, Bun, Deno, Cloudflare Workers용 runnable 애플리케이션 스타터 변형, 실행 가능한 microservice starter 경로들(TCP 기본값, 그리고 Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC), 그리고 mixed single-package 경로(Fastify HTTP 앱 + attached TCP microservice)입니다.

## 현재 공식 예제

- `./minimal/` — 기본/명시적 HTTP 스타터 경로와 같은 가장 작은 실행 가능 앱
- `./realworld-api/` — config, DTO validation, explicit DI, CRUD를 포함한 보다 현실적인 다중 모듈 HTTP API
- `./auth-jwt-passport/` — JWT 발급과 passport core 기반 보호 라우트를 보여주는 bearer-token auth 예제
- `./ops-metrics-terminus/` — `/metrics`, `/health`, `/ready`에 초점을 둔 운영 예제

## 권장 읽기 순서

레포를 처음 읽는다면 다음 순서를 권장합니다.

1. `./minimal/README.ko.md` — 가장 작은 bootstrap과 request path
2. `./realworld-api/README.ko.md` — 첫 실제 도메인 모듈과 DTO 경계
3. `./auth-jwt-passport/README.ko.md` — auth, JWT 발급, 보호 라우트 경로
4. `./ops-metrics-terminus/README.ko.md` — metrics와 health/readiness 경로
5. `../book/beginner/ch02-cli-setup.ko.md` — CLI를 통한 첫 로컬 프로젝트 설정
6. `../book/beginner/ch03-modules-providers.ko.md` — 첫 module/provider wiring과 package mental model

## 예제가 문서에서 맡는 역할

- `minimal`은 기본 경로와 flags-first 명시 경로 모두에서 `fluo new` HTTP 스타터 shape를 증명합니다
- `realworld-api`는 그 HTTP 스타터 기준선 이후 첫 실전 module/DTO/test 경로를 보여줍니다
- `auth-jwt-passport`는 현재 공식 bearer-token auth 경로를 증명합니다
- `ops-metrics-terminus`는 현재 markdown-first observability/health 경로를 증명합니다

다른 v2 스타터 계약은 CLI README에서 명령을 확인하고, 전체 계약 명세는 매트릭스 문서를 참고하세요.

- `../packages/cli/README.ko.md` — HTTP, microservice, mixed, interactive wizard 흐름의 명령 예시
- `../docs/reference/toolchain-contract-matrix.ko.md` — 공개 스타터 계약 매트릭스

이 예제들은 한 번에 읽을 수 있을 정도로 작게 유지하는 것이 목적이며, 패키지 README를 대체하지는 않습니다.

## 레포 루트에서 실행하기

```bash
pnpm install
pnpm vitest run examples/minimal
pnpm vitest run examples/realworld-api
pnpm vitest run examples/auth-jwt-passport
pnpm vitest run examples/ops-metrics-terminus
```

## 관련 문서

- `../README.ko.md`
- `../book/README.ko.md`
- `../docs/CONTEXT.ko.md`
- `../docs/getting-started/quick-start.ko.md`
- `../docs/getting-started/first-feature-path.ko.md`
