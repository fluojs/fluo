# @fluojs/cli

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 공식 CLI — 새 애플리케이션 부트스트랩, 컴포넌트 생성, 런타임 검사 데이터 내보내기, 코드 변환을 지원합니다.

## 목차

- [설치](#설치)
- [버전 확인](#버전-확인)
- [업데이트 확인](#업데이트-확인)
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
- 지원되는 설치 경로는 전역 패키지(`npm install -g @fluojs/cli`, `pnpm add -g @fluojs/cli`, `bun add -g @fluojs/cli`, `yarn global add @fluojs/cli`)와 무설치 실행 경로(`pnpm dlx @fluojs/cli ...`)입니다.
- 배포되는 `fluo` bin은 `package.json`에 선언된 dist 빌드 CLI 엔트리포인트를 기준으로 동작합니다.

## 버전 확인

Interactive update check를 실행하지 않고 설치된 CLI 버전을 확인합니다:

```bash
fluo version
fluo --version
fluo -v
```

## 업데이트 확인

`fluo`가 interactive TTY에서 실행되면 로컬 캐시를 사용해 공개 npm `latest` dist-tag의 `@fluojs/cli` 버전을 확인하므로 매 invocation마다 registry를 호출하지 않습니다. 더 새로운 버전이 있으면 CLI가 설치 여부를 묻습니다. 거절하면 현재 설치된 버전으로 기존 명령을 계속 실행하고, 승인하면 현재 설치를 소유한 것으로 보이는 package manager의 전역 업데이트 명령(`npm install -g`, `pnpm add -g`, `bun add -g`, `yarn global add`)을 사용한 뒤 같은 인자로 업데이트된 `fluo` 바이너리를 다시 시작합니다. 설치 도구를 추론할 수 없으면 Node.js 기본 전역 설치 경로를 소유하는 npm 기준으로 `npm install -g @fluojs/cli@<latest>`를 fallback으로 사용합니다.

`fluo new`와 alias인 `fluo create`는 일반 update-check cache가 아직 fresh하더라도 스캐폴딩 전에 interactive 최신 버전 확인을 새로 시도합니다. 이를 통해 첫 프로젝트 생성 경로가 방금 배포된 starter 동작과 더 잘 맞춰지며, `fluo dev`, `fluo build`, `fluo generate`, `fluo inspect` 같은 일상 명령은 기존처럼 일반 TTL이 만료될 때까지 cached latest-version 결과를 재사용합니다.

업데이트 확인은 CI, non-TTY 출력, npm-script context, 업데이트 후 재실행 context, registry/network 실패, 명시적 opt-out 경로에서는 건너뜁니다. 한 번만 끄려면 `--no-update-check`(또는 compatibility alias `--no-update-notifier`)를 사용하고, 자동화에서 절대 prompt가 뜨면 안 되는 경우에는 `FLUO_NO_UPDATE_CHECK=1`을 설정하세요.

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

`fluo create`는 `fluo new`의 alias입니다. 버전 확인, 명령 도움말, 진단, first-party package shortcut, upgrade 안내가 필요하면 `fluo version`, `fluo help <command>`, `fluo doctor`/`fluo info`/`fluo analyze`, `fluo add`, `fluo upgrade`를 사용하세요.

생성된 Node.js `dev`, `build`, `start` package script는 각각 `fluo dev`, `fluo build`, `fluo start`로 위임합니다. CLI가 Node 지향 lifecycle 명령을 소유하고 local toolchain binary를 실행할 때 project-local `node_modules/.bin`을 앞에 붙이며, 호출자가 명시하지 않은 경우 `dev`는 `NODE_ENV=development`, `build`/`start`는 `NODE_ENV=production`을 기본값으로 사용합니다. Bun, Deno, Workers의 생성된 `dev` script는 같은 `fluo dev` 추상성을 유지하되 Node-supervised dev process를 줄이도록 Bun, Deno, Wrangler의 native watch loop를 기본값으로 사용합니다. fluo가 소유한 restart boundary의 debounce/hash reporter 계약이 필요하면 `fluo dev --runner fluo` 또는 `FLUO_DEV_RUNNER=fluo`를 사용하세요. production/deployment script는 runtime-native입니다. Bun은 `bun build ./src/main.ts --outdir ./dist --target bun`과 `bun dist/main.js`를 사용하고, Deno는 `deno compile --allow-env --allow-net --output dist/app src/main.ts`와 `./dist/app`을 사용하며, Workers는 `start` 대신 Wrangler `preview`/`deploy` script를 노출합니다. 기본적으로 `fluo dev`와 `fluo start`는 CLI가 process boundary를 소유하는 경로에서 앱 로그만(애플리케이션 stdout/stderr) 표시합니다. Interactive terminal에서 fluo lifecycle status와 `app │` prefix가 붙은 애플리케이션 출력이 필요하면 `--reporter pretty`를 사용하고, 런타임/도구 watcher 원본 출력이 필요하면 `--verbose`(또는 `FLUO_VERBOSE=1`)를 사용하세요.

생성된 non-Deno starter의 `vite.config.ts`는 `@fluojs/vite`에서 `fluoDecoratorsPlugin()`을 import합니다. 따라서 decorator transform 업데이트는 각 신규 프로젝트에 inline 복사되는 대신 유지보수되는 Vite 패키지를 통해 전달됩니다.

생성된 non-Deno HTTP starter는 TDD-first Vitest 레이아웃을 사용합니다. 빠른 greeting unit test와 `greeting.slice.test.ts`는 `src/greeting/` 아래에 colocate하고, 앱 dispatch test는 `src/app.test.ts`에 유지하며, 기본 e2e 스타일 request-pipeline test는 `createTestApp({ rootModule })`와 `app.request(...).send()`를 사용해 `test/app.e2e.test.ts`에 둡니다. 생성된 `vitest.config.ts`는 `src/**/*.test.ts`와 `test/**/*.test.ts`를 모두 포함하고, package script는 `test`, `test:watch`, `test:cov`, `test:e2e`를 노출합니다. 기존 `src/app.e2e.test.ts` 테스트는 request helper를 바꾸지 않고 `test/app.e2e.test.ts`로 이동할 수 있습니다.

생성된 Node.js 애플리케이션 프로젝트에서 `fluo dev`는 기본적으로 fluo가 소유한 restart boundary를 거칩니다. 이 runner는 source와 주요 config 입력을 watch하고, atomic-save event burst를 debounce하며, restart 전에 파일 content hash를 비교하고, spawn하는 각 Node 앱 child process마다 `.env`를 로드하며, `node_modules`, `dist`, `.git`, `.fluo`, coverage, cache 폴더, editor swap file 같은 noisy output/cache 경로를 무시합니다. 파일 내용이 바뀌지 않은 Ctrl+S 저장은 앱을 재시작하지 않아야 합니다. 계획된 restart와 terminal shutdown은 현재 앱 child에 먼저 `SIGTERM`을 보내고, 제한된 grace period 뒤에도 종료되지 않으면 force-kill하므로 비협조적인 child가 restart supervisor를 무기한 멈추게 할 수 없습니다. 계획된 restart가 아닌 terminal 앱 child exit 또는 crash가 발생하면 runner는 watcher를 닫고, pending restart timer와 path를 비우며, `SIGINT`/`SIGTERM` handler를 등록 해제하고, child의 terminal code로 종료합니다. 이 동작은 full-process restart-on-watch이며 module-level HMR이 아닙니다. Config watch reload는 별도의 in-process config 관심사이고, 향후 HMR 작업은 어떤 모듈을 안전하게 hot-swap할 수 있는지 따로 문서화해야 합니다. 디버깅에 runtime-native Node watcher가 필요하면 `fluo dev --raw-watch` 또는 `FLUO_DEV_RAW_WATCH=1`을 사용하세요. 생성된 Bun/Deno/Workers 프로젝트는 기본적으로 watch/reload를 `bun --watch`, `deno run --watch`, `wrangler dev`에 위임합니다. 해당 프로젝트에서 fluo 소유 restart runner로 되돌리려면 `fluo dev --runner fluo` 또는 `FLUO_DEV_RUNNER=fluo`를 사용하고, 그 runner에 추가 ignore 경로가 필요하면 `FLUO_DEV_WATCH_IGNORE=path,pattern`으로 지정하세요.

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

지원되는 `--shape microservice --transport` 스타터 값은 정확히 `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, `grpc`입니다. 유지보수되는 Redis 기반 스타터가 필요하면 `redis-streams`를 사용하고, 더 넓은 Redis 통합 패턴이 필요하면 스캐폴딩 후 `@fluojs/redis`를 수동으로 추가하세요.

NATS/Kafka/RabbitMQ 스타터 계약은 외부 broker와 caller-owned client library 의존성을 숨기지 않고 명시적으로 유지합니다. 생성된 프로젝트는 `src/app.ts`에서 `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborator, `amqplib` publisher/consumer collaborator를 직접 연결하므로, 기본 fluo 패키지가 그 의존성을 감춘 것처럼 가장하지 않는 runnable starter 계약이 됩니다.

starter 매트릭스에는 mixed single-package starter도 포함됩니다. 하나의 Fastify HTTP 앱과 attached TCP microservice를 같은 생성 프로젝트 안에 함께 배치합니다.

```bash
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

`fluo new`가 interactive TTY에서 실행되면 wizard는 기존 flags/config 모델을 그대로 사용합니다. wizard는 프로젝트 이름, shape-first 분기(`application` -> runtime + HTTP platform, `microservice` -> transport), 유지보수 가능한 tooling preset, package manager, 즉시 dependency를 설치할지 여부, git 저장소를 초기화할지 여부를 묻습니다. non-interactive 플래그 경로와 프로그래밍 방식의 `runNewCommand(...)` 호출도 동일한 resolved defaults를 사용합니다.

side effect 없이 완전히 resolved starter를 미리 확인하려면 `--print-plan`을 사용하세요:

```bash
fluo new my-app --shape application --runtime node --platform fastify --print-plan
fluo new my-service --shape microservice --transport tcp --print-plan
fluo new my-mixed-app --shape mixed --print-plan
```

plan preview 모드는 실제 scaffold와 같은 프로젝트 이름, shape, runtime, platform, transport, tooling preset, package manager, install 선택, git 선택을 resolve합니다. 선택된 starter recipe와 dependency 세트를 출력한 뒤 파일 생성, dependency 설치, git 저장소 초기화 없이 종료합니다.

현재 제공되는 스타터 매트릭스(Node.js Fastify/Express/raw Node.js HTTP, Bun, Deno, Cloudflare Workers, TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC microservice, 그리고 mixed)와 남아 있는 더 넓은 어댑터 생태계를 문서 수준에서 구분한 표는 [fluo new 지원 매트릭스](../../docs/reference/fluo-new-support-matrix.ko.md)를 확인하세요. `@fluojs/redis` 같은 패키지 수준 통합은 더 넓은 생태계에 남아 있지만, 추가 `fluo new --transport` 스타터 플래그는 아닙니다.

### 2. 기능 추가
feature slice를 생성합니다. 일부 schematic은 모듈에 자동 등록되고, 일부는 파일만 생성하므로 직접 wiring해야 합니다.

```bash
fluo generate module users
fluo generate module users --with-test
fluo generate resource users
fluo generate resource users --with-slice-test
fluo generate e2e users
fluo generate controller users
fluo generate service users
fluo generate request-dto users CreateUser
fluo generate service users --dry-run
```

지원되는 generator kind와 alias는 `controller`/`co`, `e2e`, `guard`/`gu`, `interceptor`/`in`, `middleware`/`mi`, `module`/`mo`, `repo`/`repository`, `request-dto`/`req`, `resource`/`resrc`, `response-dto`/`res`, `service`/`s`입니다.

자동 등록되는 generator는 `controller`, `service`, `repo`, `guard`, `interceptor`, `middleware`입니다. 파일만 생성하는 generator는 `e2e`, `module`, `request-dto`, `response-dto`, `resource`입니다.

`fluo generate module <name> --with-test`는 작성한 module을 `createTestingModule({ rootModule })`로 컴파일하는 `*.slice.test.ts`를 추가합니다. `fluo generate resource <name>`는 module, controller, service, repository, request DTO, response DTO, test를 포함하는 완전한 feature slice를 생성합니다. `--with-slice-test`를 추가하면 provider override와 service resolution을 보여 주는 resource-level slice test도 포함합니다. 생성된 resource module은 parent module에 자동으로 연결하지 않으므로, slice를 활성화할 준비가 되었을 때 직접 import하세요.

`fluo generate e2e <name>`는 generated starter와 같은 app-level test 영역에 request-pipeline test를 두도록 `createTestApp({ rootModule: AppModule })`을 사용하는 `test/<name>.e2e.test.ts`를 작성합니다. 생성된 unit test는 직접 class 동작 검증에, slice test는 DI wiring과 override 검증에, e2e test는 virtual app을 통과하는 route, guard, interceptor, DTO validation, response writing 검증에 사용하세요.

Request DTO 생성은 feature 디렉터리와 DTO 클래스 이름을 분리해서 받습니다. 따라서 `CreateUser`, `UpdateUser` 같은 여러 입력 계약을 같은 `src/users/` 슬라이스 안에 둘 수 있습니다.

`--dry-run`을 추가하면 실제 실행과 같은 타깃 해석, 기존 파일 건너뛰기 또는 덮어쓰기 판단, 모듈 자동 등록 계획, 파일만 생성하는 wiring 상태, 다음 단계 힌트를 미리 볼 수 있습니다. 이 모드는 디렉터리 생성, 파일 쓰기, 모듈 갱신을 수행하지 않습니다. `--force`는 내용이 달라질 기존 파일의 계획 항목을 `SKIP`에서 `OVERWRITE`로 바꾸며, `--target-directory`는 실제 실행과 동일하게 지정한 소스 디렉터리 기준으로 preview 범위를 제한합니다.

Generator discovery는 의도적으로 built-in `@fluojs/cli/builtin` collection으로 제한됩니다. 외부 package-owned 또는 app-local generator collection은 보류되어 있습니다. `fluo generate`는 config file을 스캔하거나, 임의 package를 로드하거나, workspace-owned collection code를 실행하지 않습니다. 이 경계는 shipped generator 계약을 보존하면서 generator metadata, option schema, help output, file-write boundary를 결정적이고 테스트 가능하게 유지합니다.

## 주요 패턴

### 진단과 프로젝트 스크립트
설치된 CLI, npm dist-tag, update-check cache 상태, runtime, project script를 확인해야 할 때는 `doctor`/`info`를 사용합니다:

```bash
fluo doctor
fluo info
fluo analyze
```

`fluo analyze`는 read-only로 동작하며 더 깊은 `inspect --report`와 `migrate --json` workflow를 안내합니다. 생성된 Node.js 프로젝트에서는 `fluo dev`, `fluo build`, `fluo start`가 환경 기본값 및 project-local toolchain binary와 함께 생성 lifecycle을 직접 실행합니다. 생성된 Bun, Deno, Cloudflare Workers 프로젝트에서는 `fluo dev`가 runtime-owned watch loop를 기본값으로 사용하고, `fluo dev --runner fluo`가 CLI 소유 restart boundary를 복원합니다. production/deployment에는 생성된 package script(`bun dist/main.js`, `./dist/app`, Wrangler `preview`/`deploy`)를 사용합니다. lifecycle 명령은 `--dry-run`으로 미리 확인할 수 있습니다:

```bash
fluo dev --dry-run
fluo build --dry-run
fluo start --dry-run
```

`fluo dev --dry-run`은 watch boundary도 함께 표시합니다. 생성된 Node 프로젝트는 기본적으로 `Watch mode: fluo-restart`를 보여 주며, Node의 `--raw-watch` 또는 `FLUO_DEV_RAW_WATCH=1`은 `Watch mode: native-watch`를 보여 줍니다. Bun/Deno/Workers 프로젝트는 기본적으로 `Watch mode: runtime-native-watch`를 보여 주며, `--runner fluo` 또는 `FLUO_DEV_RUNNER=fluo`를 사용하면 `Watch mode: fluo-restart`로 fluo 소유 restart runner가 복원됩니다.

CLI process boundary를 조정해야 할 때는 런타임 앱 로깅이 아니라 reporter flag를 사용하세요:

```bash
# 기본값: child stdout/stderr만 표시, fluo lifecycle UI 없음
fluo dev

# opt-in pretty lifecycle UI + app │ prefix
fluo dev --reporter pretty

# 디버깅용 raw 런타임/도구 출력(Watcher 배너, native dev UI 등)
fluo dev --reporter stream
fluo dev --verbose
FLUO_VERBOSE=1 fluo dev

# child stderr와 실패는 보존하면서 wrapper/tool status는 숨김
fluo build --reporter silent
```

런타임 애플리케이션 로그는 `ApplicationLogger`로 별도 설정합니다. 예를 들어 `@fluojs/runtime/node`의 `createConsoleApplicationLogger({ mode: 'minimal', level: 'warn' })` 또는 `createJsonApplicationLogger()`를 사용하세요.

first-party package 설치 shortcut에는 `fluo add <package>`를 사용하고, CLI/latest-version 및 migration 안내는 `fluo upgrade`로 확인합니다:

```bash
fluo add studio --dev --dry-run
fluo upgrade
```

### 데코레이터 코드 변환
코드베이스를 TC39 표준 데코레이터에 맞게 조정하는 codemod를 실행합니다.

```bash
# 변경 사항 미리보기 (dry-run)
fluo migrate ./src
fluo migrate ./src --json

# 변환 적용
fluo migrate ./src --apply
fluo migrate ./src --apply --json
fluo migrate ./src --only imports,inject-params
fluo migrate ./src --skip tests
```

CI 작업, 대시보드, migration report에서 안정적인 machine-readable 결과가 필요하면 `--json`을 사용하세요. 사람을 위한 출력은 기본값으로 유지됩니다. JSON 모드는 성공 시 stdout에 structured report만 기록하고, parser 오류나 잘못된 flag 조합은 기존처럼 stderr에 메시지를 기록한 뒤 exit code `1`을 반환하며 partial JSON을 출력하지 않습니다. Report에는 `mode`(`dry-run` 또는 `apply`), `dryRun`, `apply`, 활성화된 `transforms`, `scannedFiles`, `changedFiles`, 전체 `warningCount`, 그리고 `filePath`, `changed`, `appliedTransforms`, `warningCount`, category label과 source line number가 포함된 warnings per-file metadata가 포함됩니다.

**주요 변환 사항:**
- `@nestjs/common` 임포트를 `@fluojs/core` 또는 `@fluojs/http`로 재작성합니다.
- bootstrap 패턴을 재작성하고 지원되는 `listen(port)` 호출을 fluo runtime startup 규칙으로 접습니다.
- constructor parameter `@Inject(...)` 사용을 fluo 호환 의존성 선언으로 migration합니다.
- `@Injectable()`을 제거하고 스코프를 `@Scope()`로 매핑합니다.
- 안전하게 변환 가능한 test template을 `@fluojs/testing` helper 쪽으로 migration합니다.
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

# 특정 module export 검사; 기본값은 AppModule
fluo inspect ./src/app.module.ts --export AdminModule --json
```

런타임이 inspection snapshot을 생산합니다. `fluo inspect`는 output mode flag가 없을 때 기본적으로 그 snapshot을 JSON으로 직렬화하고, `fluo inspect --mermaid`는 snapshot-to-Mermaid 렌더링을 선택적 `@fluojs/studio` 계약에 위임합니다. `--export <name>`은 bootstrap할 module export를 선택하며 기본값은 `AppModule`입니다. `--timing`은 JSON 출력에 bootstrap timing diagnostics를 기록하고, `--report`는 CI/support triage를 위해 런타임이 생산한 snapshot을 안정적인 요약과 함께 감쌉니다. `--timing`은 Mermaid 출력과 함께 사용할 수 없습니다. `--output <path>`는 선택한 inspect payload를 stdout 대신 명시적 artifact 경로에 씁니다. 이 동작은 검사 대상 애플리케이션을 writable하게 만들지 않으며, 일반 bootstrap/close cycle 외에 module graph state를 바꾸지 않습니다. Mermaid 출력이 필요하면 명령을 실행하는 프로젝트에 Studio를 설치하세요:

```bash
pnpm add -D @fluojs/studio
```

Studio가 없으면 CI와 non-interactive 실행은 prompt나 package manager 실행 없이 설치 안내와 함께 빠르게 실패합니다. Interactive 실행에서는 Studio 설치 여부를 물을 수 있지만, 명시적으로 승인되고 구현된 설치 흐름이 없는 한 `fluo inspect`가 package manager install을 실행하지 않습니다.

## 공개 API

다른 도구 내에서 CLI 동작을 트리거하기 위해 패키지를 프로그래밍 방식으로 사용할 수 있습니다.

| 익스포트 | 설명 |
|---|---|
| `runCli(argv?, options?)` | 모든 CLI 명령을 실행하는 메인 진입점입니다. |
| `newUsage()` | help surface와 test에서 사용하는 현재 `fluo new` usage text를 반환합니다. |
| `runNewCommand(argv, options?)` | 프로젝트 스캐폴딩 로직에 대한 프로그래밍적 접근을 제공합니다. |
| `CliPromptCancelledError` | 호출자가 제공한 prompt hook이 정상 취소를 알리기 위해 throw할 수 있는 안정적인 sentinel입니다. |
| `GenerateOptions` | 프로그래밍 방식 generator 옵션 타입입니다. |
| `GeneratedFile` | 생성된 파일 경로, 내용, write status를 설명하는 타입입니다. |
| `GeneratorKind` | 지원되는 모든 생성기 유형(예: `'controller'`, `'service'`)의 유니온 타입입니다. |
| `ModuleRegistration` | generator 실행의 module wiring 결과를 설명하는 타입입니다. |

프로그래밍 방식 진입점은 호출자 프로세스의 소유권을 보존합니다. `runCli(...)`와 `runNewCommand(...)`는 `process.exit(...)`를 호출하지 않고 숫자 exit code를 반환하며, prompt 취소는 command runner를 통해 exit code `0`으로 해석됩니다. dependency 설치나 git 초기화 같은 setup 작업은 해석된 `fluo new` 옵션이 요청한 경우에만 실행됩니다. 호출자가 제공한 prompt hook은 공개 패키지 엔트리포인트의 `CliPromptCancelledError`를 throw해 CLI 내부 파일에 의존하지 않고 정상 취소를 표현할 수 있습니다.

## 관련 패키지

- **[@fluojs/runtime](../runtime/README.ko.md)**: 부트스트랩 안전 런타임 검사 중 inspection snapshot을 생산하는 기본 엔진입니다.
- **[@fluojs/studio](../studio/README.ko.md)**: `inspect --json` 출력을 확인하고 `inspect --mermaid`가 사용하는 canonical renderer를 제공하는 웹 기반 UI입니다.
- **[@fluojs/testing](../testing/README.ko.md)**: 통합 및 E2E 테스트를 위해 생성된 테스트 템플릿에서 사용됩니다.
- **[@fluojs/vite](../vite/README.ko.md)**: 생성된 starter의 Vite decorator transform plugin을 제공합니다.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.ko.md)**: 공식 런타임/패키지 조합을 보여주는 기준 문서입니다.

## 예제 소스

- [cli.ts](./src/cli.ts) - 명령 디스패처 및 인자 파싱.
- [commands/new.ts](./src/commands/new.ts) - 프로젝트 스캐폴딩 구현.
- [commands/inspect.ts](./src/commands/inspect.ts) - 런타임 검사 export mode와 Studio 위임.
- [commands/migrate.ts](./src/commands/migrate.ts) - decorator codemod, JSON report, transform filter.
- [commands/package-workflow.ts](./src/commands/package-workflow.ts) - `fluo add`와 `fluo upgrade` workflow.
- [commands/scripts.ts](./src/commands/scripts.ts) - `dev`, `build`, `start` lifecycle command boundary.
- [update-check.ts](./src/update-check.ts) - interactive latest-version update check와 opt-out 처리.
- [new/](./src/new/) - starter matrix 해석, prompt, scaffold 실행.
- [dev-runner/](./src/dev-runner/) - Node restart-on-watch process boundary.
- [generators/](./src/generators/) - 템플릿 기반 파일 생성 로직.
- [transforms/](./src/transforms/) - 코드 변환 구현.
