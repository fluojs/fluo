# Setup Command Reference

<p><a href="./quick-start.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Prerequisites

- 호스트 시스템에 Node.js 런타임이 있어야 합니다.
- 호스트 시스템에 `pnpm`이 있어야 합니다.
- 전역 패키지 설치 또는 `pnpm dlx` 실행 권한이 있는 셸 세션이 필요합니다.
- 기본 생성 경로는 Node.js runtime, HTTP transport, Fastify platform입니다.

## Installation

fluo CLI는 프로젝트 스캐폴딩과 컴포넌트 생성을 위한 명령 진입점입니다.

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

### Previewing a starter plan

파일시스템을 건드리지 않고 해석된 스타터를 확인해야 할 때는 `--print-plan`을 사용하세요:

```bash
fluo new my-fluo-app --print-plan
fluo new my-service --shape microservice --transport tcp --print-plan
fluo new my-mixed-app --shape mixed --print-plan
```

Plan preview 모드는 실제 scaffold와 같은 프로젝트 이름, target directory, shape, runtime, platform, transport, tooling preset, package manager, dependency installation 선택, git initialization 선택을 resolve합니다. 선택된 starter recipe와 runtime/dev dependency 세트를 출력한 뒤 side effect 없이 종료합니다. 파일을 생성하거나, dependency를 설치하거나, git을 초기화하지 않습니다.

## Development Server

프로젝트 루트 기준 생성된 프로젝트 시작 명령:

```bash
pnpm dev
```

기본 Node.js + Fastify 스타터는 `fluo dev`, `fluo build`, `fluo start`를 실행하는 lifecycle script를 생성합니다. 이 CLI lifecycle runner들은 스타터의 런타임 명령을 선택하고, 호출자가 이미 설정하지 않은 경우 dev는 `NODE_ENV=development`, build/start는 `NODE_ENV=production`을 기본 설정합니다. Bun, Deno, Cloudflare Workers 스타터도 restart-on-watch 개발 boundary에는 `fluo dev`를 사용하지만, 생성된 production/deployment script는 runtime-native 명령을 사용합니다. Bun은 `bun build`로 빌드하고 `bun dist/main.js`로 시작하며, Deno는 `deno compile` 후 컴파일된 `./dist/app`을 실행하고, Workers는 `start` script 대신 Wrangler `preview`/`deploy` script를 노출합니다.

예상 출력 패턴:

```text
Server listening on http://localhost:3000
```

기본 확인 엔드포인트:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/greeting
```

예상 출력:

```text
{"status":"ok"}
{"message":"Hello from fluo","framework":"fluo","project":"my-fluo-app"}
```

## Invariants

- `tsconfig.json`에서 `experimentalDecorators`는 비활성화 상태를 유지합니다.
- `tsconfig.json`에서 `emitDecoratorMetadata`는 비활성화 상태를 유지합니다.
- 기본 생성 Node.js 애플리케이션은 `fluo dev`로 위임되는 `pnpm dev` 중 포트 `3000`에서 리슨하며, 생성된 build/start script도 각각 `fluo build`, `fluo start`로 위임됩니다.
- 생성된 Bun 및 Deno 애플리케이션의 production script는 build 이후 runtime-native 명령을 사용하고, 생성된 Cloudflare Workers 애플리케이션은 `start` 대신 Wrangler `preview`/`deploy` script를 사용합니다.
- 기본 생성 애플리케이션은 runtime `/health`와 starter-owned `/greeting`을 노출합니다.
- `fluo new` 스타터 변형은 CLI README와 지원 매트릭스에 문서화된 유지보수 대상 스타터 매트릭스에 맞춰집니다.
- `fluo new --print-plan`은 읽기 전용 preview 경로입니다. 프로젝트 파일 작성, dependency 설치, git 초기화 없이 starter plan과 dependency 세트를 해석합니다.
