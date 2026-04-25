# @fluojs/cli

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 공식 CLI — 새 애플리케이션 부트스트랩, 컴포넌트 생성, 런타임 검사 데이터 내보내기, 코드 변환을 지원합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add -g @fluojs/cli
```

설치 없이 직접 실행하려면:

```bash
pnpm dlx @fluojs/cli new my-app
```

## 릴리스 계약

- `@fluojs/cli`는 intended publish surface에 포함되는 공개 패키지입니다.
- 지원되는 설치 경로는 전역 패키지(`pnpm add -g @fluojs/cli`)와 무설치 실행 경로(`pnpm dlx @fluojs/cli ...`)입니다.
- 배포되는 `fluo` bin은 `package.json`에 선언된 dist 빌드 CLI 엔트리포인트를 기준으로 동작합니다.

## 사용 시점

- **부트스트랩**: 표준적이고 검증 가능한 구조로 새 프로젝트를 시작할 때.
- **코드 생성**: 일관된 네이밍 규칙과 자동 연결 기능을 갖춘 모듈, 컨트롤러, 서비스, 레포지토리를 생성할 때.
- **코드 변환**: 기존 코드베이스를 fluo의 표준 데코레이터 모델에 맞출 때.
- **검사(Inspection)**: 런타임 snapshot 데이터를 내보내고 그래프 보기 또는 렌더링은 Studio 소유 헬퍼에 위임할 때.

## 빠른 시작

### 1. 새 프로젝트 생성
몇 초 만에 완전한 스타터 애플리케이션을 스캐폴딩합니다.

```bash
fluo new my-app
cd my-app
pnpm dev
```

`fluo new`는 같은 Node 기반 설치/빌드 흐름 위에서 Node.js + Fastify, Express, raw Node.js HTTP 애플리케이션 스타터를 제공합니다.

```bash
fluo new my-app --shape application --transport http --runtime node --platform fastify
fluo new my-express-app --shape application --transport http --runtime node --platform express
fluo new my-node-app --shape application --transport http --runtime node --platform nodejs
```

애플리케이션 매트릭스에는 런타임별 entrypoint, scripts, dependency 세트를 갖춘 Bun, Deno, Cloudflare Workers 네이티브 스타터도 포함됩니다.

```bash
fluo new my-bun-app --shape application --transport http --runtime bun --platform bun
fluo new my-deno-app --shape application --transport http --runtime deno --platform deno
fluo new my-worker-app --shape application --transport http --runtime cloudflare-workers --platform cloudflare-workers
```

`fluo new`는 microservice starter path도 제공합니다. `--transport`를 생략하면 TCP가 기본 경로로 사용되며, starter 매트릭스에는 transport별 dependency, env 템플릿, entrypoint를 갖춘 Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 변형도 포함됩니다.

```bash
fluo new my-microservice --shape microservice --transport tcp --runtime node --platform none
fluo new my-redis-streams-service --shape microservice --transport redis-streams --runtime node --platform none
fluo new my-nats-service --shape microservice --transport nats --runtime node --platform none
fluo new my-kafka-service --shape microservice --transport kafka --runtime node --platform none
fluo new my-rabbitmq-service --shape microservice --transport rabbitmq --runtime node --platform none
fluo new my-mqtt-service --shape microservice --transport mqtt --runtime node --platform none
fluo new my-grpc-service --shape microservice --transport grpc --runtime node --platform none
```

지원되는 `--shape microservice --transport` 스타터 값은 정확히 `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, `grpc`입니다. 이전 문서에 있던 `redis` 값은 더 이상 제공되는 스타터 계약에 포함되지 않으며, 유지보수되는 Redis 기반 스타터가 필요하면 `redis-streams`를 사용하고, 더 넓은 Redis 통합 패턴이 필요하면 스캐폴딩 후 `@fluojs/redis`를 수동으로 추가하세요.

NATS/Kafka/RabbitMQ 스타터 계약은 외부 broker와 caller-owned client library 의존성을 숨기지 않고 명시적으로 유지합니다. 생성된 프로젝트는 `src/app.ts`에서 `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborator, `amqplib` publisher/consumer collaborator를 직접 연결하므로, 기본 fluo 패키지가 그 의존성을 감춘 것처럼 가장하지 않는 runnable starter 계약이 됩니다.

starter 매트릭스에는 mixed single-package starter도 포함됩니다. 하나의 Fastify HTTP 앱과 attached TCP microservice를 같은 생성 프로젝트 안에 함께 배치합니다.

```bash
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

`fluo new`가 interactive TTY에서 실행되면 wizard는 기존 flags/config 모델을 그대로 사용합니다. wizard는 프로젝트 이름, shape-first 분기(`application` -> runtime + HTTP platform, `microservice` -> transport), 유지보수 가능한 tooling preset, package manager, 즉시 dependency를 설치할지 여부, git 저장소를 초기화할지 여부를 묻습니다. non-interactive 플래그 경로와 프로그래밍 방식의 `runNewCommand(...)` 호출도 동일한 resolved defaults를 사용합니다.

현재 제공되는 스타터 매트릭스(Node.js Fastify/Express/raw Node.js HTTP, Bun, Deno, Cloudflare Workers, TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC microservice, 그리고 mixed)와 남아 있는 더 넓은 어댑터 생태계를 문서 수준에서 구분한 표는 [fluo new 지원 매트릭스](../../docs/reference/fluo-new-support-matrix.ko.md)를 확인하세요. `@fluojs/redis` 같은 패키지 수준 통합은 더 넓은 생태계에 남아 있지만, 추가 `fluo new --transport` 스타터 플래그는 아닙니다.

### 2. 기능 추가
컨트롤러와 서비스가 포함된 새 리소스를 추가하고, 모듈에 자동으로 연결합니다.

```bash
fluo generate module users
fluo generate controller users
fluo generate service users
fluo generate request-dto users CreateUser
```

Request DTO 생성은 feature 디렉터리와 DTO 클래스 이름을 분리해서 받습니다. 따라서 `CreateUser`, `UpdateUser` 같은 여러 입력 계약을 같은 `src/users/` 슬라이스 안에 둘 수 있습니다.

## 주요 패턴

### 데코레이터 코드 변환
코드베이스를 TC39 표준 데코레이터에 맞게 조정하는 codemod를 실행합니다.

```bash
# 변경 사항 미리보기 (dry-run)
fluo migrate ./src
fluo migrate ./src --json

# 변환 적용
fluo migrate ./src --apply
fluo migrate ./src --apply --json
```

CI 작업, 대시보드, migration report에서 안정적인 machine-readable 결과가 필요하면 `--json`을 사용하세요. 사람을 위한 출력은 기본값으로 유지됩니다. JSON 모드는 성공 시 stdout에 structured report만 기록하고, parser 오류나 잘못된 flag 조합은 기존처럼 stderr에 메시지를 기록한 뒤 exit code `1`을 반환하며 partial JSON을 출력하지 않습니다. Report에는 `mode`(`dry-run` 또는 `apply`), `dryRun`, `apply`, 활성화된 `transforms`, `scannedFiles`, `changedFiles`, 전체 `warningCount`, 그리고 `filePath`, `changed`, `appliedTransforms`, `warningCount`, category label과 source line number가 포함된 warnings per-file metadata가 포함됩니다.

**주요 변환 사항:**
- `@nestjs/common` 임포트를 `@fluojs/core` 또는 `@fluojs/http`로 재작성합니다.
- `@Injectable()`을 제거하고 스코프를 `@Scope()`로 매핑합니다.
- `tsconfig.json`을 업데이트하여 `experimentalDecorators`를 비활성화하고 `baseUrl` 기반 경로 별칭을 TS6-safe `paths` 엔트리로 재작성합니다.

### 런타임 검사 (Inspection)
CLI가 그래프 렌더링을 소유하지 않으면서 애플리케이션 구조를 내보내고 초기화 문제를 해결합니다.

```bash
# 선택적 Studio 렌더러를 통해 Mermaid 내보내기
fluo inspect ./src/app.module.ts --mermaid

# @fluojs/studio용 snapshot 내보내기
fluo inspect ./src/app.module.ts --json > snapshot.json

# shell redirection 없이 같은 JSON snapshot을 CI artifact 경로에 쓰기
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json

# 런타임이 생산한 snapshot 옆에 bootstrap timing 포함하기
fluo inspect ./src/app.module.ts --json --timing

# 요약, snapshot, diagnostics, timing을 포함한 support triage report 내보내기
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

런타임이 inspection snapshot을 생산합니다. `fluo inspect`는 그 snapshot을 JSON으로 직렬화하고, `fluo inspect --mermaid`는 snapshot-to-Mermaid 렌더링을 선택적 `@fluojs/studio` 계약에 위임합니다. `--timing`은 JSON 출력에 bootstrap timing diagnostics를 기록하고, `--report`는 CI/support triage를 위해 런타임이 생산한 snapshot을 안정적인 요약과 함께 감쌉니다. `--output <path>`는 선택한 inspect payload를 stdout 대신 명시적 artifact 경로에 씁니다. 이 동작은 검사 대상 애플리케이션을 writable하게 만들지 않으며, 일반 bootstrap/close cycle 외에 module graph state를 바꾸지 않습니다. Mermaid 출력이 필요하면 명령을 실행하는 프로젝트에 Studio를 설치하세요:

```bash
pnpm add -D @fluojs/studio
```

Studio가 없으면 CI와 non-interactive 실행은 prompt나 package manager 실행 없이 설치 안내와 함께 빠르게 실패합니다. Interactive 실행에서는 Studio 설치 여부를 물을 수 있지만, 명시적으로 승인되고 구현된 설치 흐름이 없는 한 `fluo inspect`가 package manager install을 실행하지 않습니다.

## 공개 API

다른 도구 내에서 CLI 동작을 트리거하기 위해 패키지를 프로그래밍 방식으로 사용할 수 있습니다.

| 익스포트 | 설명 |
|---|---|
| `runCli(argv?, options?)` | 모든 CLI 명령을 실행하는 메인 진입점입니다. |
| `runNewCommand(argv, options?)` | 프로젝트 스캐폴딩 로직에 대한 프로그래밍적 접근을 제공합니다. |
| `GeneratorKind` | 지원되는 모든 생성기 유형(예: `'controller'`, `'service'`)의 유니온 타입입니다. |

## 관련 패키지

- **[@fluojs/runtime](../runtime/README.ko.md)**: 부트스트랩 안전 런타임 검사 중 inspection snapshot을 생산하는 기본 엔진입니다.
- **[@fluojs/studio](../studio/README.ko.md)**: `inspect --json` 출력을 확인하고 `inspect --mermaid`가 사용하는 canonical renderer를 제공하는 웹 기반 UI입니다.
- **[@fluojs/testing](../testing/README.ko.md)**: 통합 및 E2E 테스트를 위해 생성된 테스트 템플릿에서 사용됩니다.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.ko.md)**: 공식 런타임/패키지 조합을 보여주는 기준 문서입니다.

## 예제 소스

- [cli.ts](./src/cli.ts) - 명령 디스패처 및 인자 파싱.
- [commands/new.ts](./src/commands/new.ts) - 프로젝트 스캐폴딩 구현.
- [generators/](./src/generators/) - 템플릿 기반 파일 생성 로직.
- [transforms/](./src/transforms/) - 코드 변환 구현.
