# Setup Command Reference

<p><a href="./quick-start.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Prerequisites

- 호스트 시스템에 Node.js 런타임이 있어야 합니다.
- 호스트 시스템에 `pnpm`이 있어야 합니다.
- 전역 패키지 설치 또는 `pnpm dlx` 실행 권한이 있는 셸 세션이 필요합니다.
- 기본 생성 경로는 Node.js runtime, HTTP transport, Fastify platform입니다.

## Installation

fluo CLI는 프로젝트 스캐폴딩과 컴포넌트 생성을 위한 중심 도구입니다.

전역 설치:

```bash
pnpm add -g @fluojs/cli
```

예상 출력 패턴:

```text
Packages: +1
dependencies:
+ @fluojs/cli <version>
Done in <time>
```

설치 없이 실행하는 경로:

```bash
pnpm dlx @fluojs/cli new my-fluo-app
```

## Project Creation

기본 애플리케이션 스타터:

```bash
fluo new my-fluo-app
cd my-fluo-app
```

예상 출력 패턴:

```text
Scaffolding project: my-fluo-app
Template: application/http/node/fastify
Installing dependencies: <package-manager-dependent>
Project ready
```

대표적인 명시적 스타터:

```bash
fluo new my-app --shape application --transport http --runtime node --platform fastify
fluo new my-express-app --shape application --transport http --runtime node --platform express
fluo new my-node-app --shape application --transport http --runtime node --platform nodejs
fluo new my-bun-app --shape application --transport http --runtime bun --platform bun
fluo new my-deno-app --shape application --transport http --runtime deno --platform deno
fluo new my-worker-app --shape application --transport http --runtime cloudflare-workers --platform cloudflare-workers
fluo new my-microservice --shape microservice --transport tcp --runtime node --platform none
fluo new my-redis-streams-service --shape microservice --transport redis-streams --runtime node --platform none
fluo new my-nats-service --shape microservice --transport nats --runtime node --platform none
fluo new my-kafka-service --shape microservice --transport kafka --runtime node --platform none
fluo new my-rabbitmq-service --shape microservice --transport rabbitmq --runtime node --platform none
fluo new my-mqtt-service --shape microservice --transport mqtt --runtime node --platform none
fluo new my-grpc-service --shape microservice --transport grpc --runtime node --platform none
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

기본 애플리케이션 스타터가 생성하는 아티팩트:

```text
my-fluo-app/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── src/
    ├── app.ts
    ├── hello.controller.ts
    ├── hello.service.ts
    └── main.ts
```

기준 스타터 매트릭스: [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md).

interactive terminal에서 `fluo new` wizard를 실행할 경우, 파일을 쓰기 전에 동일한 유지보수 대상 스타터 매트릭스를 기준으로 선택지가 해석됩니다.

## Development Server

프로젝트 루트 기준 생성된 프로젝트 시작 명령:

```bash
pnpm dev
```

예상 출력 패턴:

```text
Server listening on http://localhost:3000
```

기본 확인 엔드포인트:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/hello
```

예상 출력:

```text
{"status":"ok"}
{"message":"Hello, World!"}
```

## Invariants

- `tsconfig.json`에서 `experimentalDecorators`는 비활성화 상태를 유지합니다.
- `tsconfig.json`에서 `emitDecoratorMetadata`는 비활성화 상태를 유지합니다.
- 기본 생성 애플리케이션은 `pnpm dev` 중 포트 `3000`에서 리슨합니다.
- 기본 생성 애플리케이션은 `/health`와 `/hello`를 노출합니다.
- `fluo new` 스타터 변형은 CLI README와 지원 매트릭스에 문서화된 유지보수 대상 스타터 매트릭스에 맞춰집니다.
