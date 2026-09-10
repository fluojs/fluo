# @fluojs/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 raw Node.js HTTP 어댑터 패키지입니다.

Coordinated Node 24 릴리스를 준비한다면 패키지 업그레이드 전에 [소비자 마이그레이션 가이드](../../docs/getting-started/migrate-node24.ko.md)를 따르세요.

## 목차

- [설치](#설치)
- [Runtime Node import 마이그레이션](#runtime-node-import-마이그레이션)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [동작 계약](#동작-계약)
- [Conformance 커버리지](#conformance-커버리지)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-nodejs
```

이 패키지는 Node.js `>=24.0.0 <27`을 대상으로 하며 package manifest는 같은 `engines.node` 범위를 선언합니다. Node 24 LTS floor는 지원 정책 결정이며 RFC `QUERY` listener 동작은 이 지원 범위에서 계속 검증합니다. 이 패키지는 raw Node, Express, Fastify host가 사용하는 Node listener, filesystem, logger, compression, process-signal 구현을 소유합니다.

## Runtime Node import 마이그레이션

이전 mixed-runtime entrypoint에는 compatibility shim이 없습니다. Import를 직접 바꾼 뒤 아래 adapter 생성 마이그레이션을 적용하세요.

| 제거된 import | 대체 import |
| :--- | :--- |
| `@fluojs/runtime/node` | `@fluojs/platform-nodejs` |
| `@fluojs/runtime/internal-node` | `@fluojs/platform-nodejs/internal` |

Adapter 생성은 `NodeHttpApplicationAdapter.create(options)`로 통합되었습니다. 제거된 두 factory와 타입 별칭의 변경 목록은 [Node adapter 생성 마이그레이션](../../docs/getting-started/migrate-node-adapter-create.ko.md)을 따르세요. `NodeHttpApplicationAdapter` 클래스와 공개 positional constructor는 유지됩니다. Bootstrap/run helper와 Nodejs alias는 제거되며 logger, shutdown registration, filesystem utility는 유지됩니다.

## 사용 시점

Express나 Fastify와 같은 중간 프레임워크의 오버헤드 없이 Node.js 내장 `http` 또는 `https` 모듈에서 직접 fluo 애플리케이션을 실행하려는 경우에 사용합니다. 최소한의 리소스 사용, 저수준 최적화 또는 표준 Node API가 선호되는 환경에 이상적입니다.

## 빠른 시작

```typescript
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### Early Hints

Raw Node response는 `context.response.earlyHints`를 노출합니다. 이 optional capability를 확인한 뒤 HTTP `103` 하나마다 `write(...)`를 await하세요. 여러 write를 지원합니다. 각 write에는 비어 있지 않은 `link` value가 필요하며 Node가 허용하는 다른 informational field도 포함할 수 있습니다. Native write는 final response를 commit하거나 early field를 final header로 복사하지 않습니다. Late/native failure는 `EarlyHintsWriteError`로 reject되고 settlement 전에 연결이 끊기면 `RequestAbortedError`로 reject됩니다.

### 서버 옵션 커스텀
어댑터는 문서화된 Node.js transport 옵션인 host/port 바인딩, plain HTTP 또는 HTTPS 생성 설정, request body 제한, raw-body 보존, listen retry 설정, shutdown drain bound를 제공합니다.

```typescript
const adapter = NodeHttpApplicationAdapter.create({
  port: 3000,
  http: {
    maxHeaderSize: 16_384,
    joinDuplicateHeaders: true,
  },
  maxBodySize: 1_048_576,
  compression: true,
  multipart: { maxTotalSize: 2_097_152 },
});
```

`http`는 Node의 `node:http` `ServerOptions`를 받고 listener가 시작되기 전에 `createServer(options, handler)`로 전달합니다. `maxHeaderSize`, `insecureHTTPParser`, `joinDuplicateHeaders`, `highWaterMark` 같은 생성 시점 설정에 사용하세요. TLS에는 Node HTTPS server option이 담긴 `https`를 대신 제공하세요. `http`와 `https`는 동시에 사용할 수 없으며, 둘 다 제공하면 adapter가 server를 만들기 전에 throw하므로 어느 option도 조용히 무시되지 않습니다.

`maxBodySize`는 바이트 수를 나타내는 숫자만 받습니다. 이 값은 raw Node 요청 바디가 아직 스트리밍되는 동안 바로 강제되며, adapter 생성 시 `multipart.maxTotalSize`를 따로 재정의하지 않으면 같은 값이 멀티파트 전체 페이로드 한도의 기본값으로도 사용됩니다.

`NodeHttpApplicationAdapter.create()`는 기본 port로 `3000`을 사용하고 `process.env.PORT`를 무시하며, `port`, `maxBodySize`, `retryDelayMs`, `retryLimit`, adapter-level `shutdownTimeoutMs`가 잘못되면 throw합니다. 기본 request body cap은 `1 MiB`입니다.

기본값: `compression: false`, `rawBody: false`, `retryDelayMs: 150`, `retryLimit: 20`, `shutdownTimeoutMs: 10_000`입니다. `host` 생략 시 Node가 bind address를 선택합니다. Multipart는 buffered parsing을 기본으로 하고, `multipart.maxTotalSize`를 생략하면 유효 `maxBodySize`를 따릅니다(둘 다 생략하면 `1_048_576` bytes). 명시한 `0`도 보존합니다. Compression을 켜도 range 응답은 원본 representation byte와 range metadata를 유지하며 다시 압축하지 않습니다.

### 직접 애플리케이션 실행
생성은 port를 bind하거나 process signal을 등록하지 않습니다.

`FluoFactory.create(AppModule, { adapter })`로 생성하고 `app.listen()`으로 시작합니다. 아래 Node logger와 shutdown callback은 이 host boundary에서 명시적으로 선택합니다.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({
    port: 3000,
    shutdownTimeoutMs: 10_000,
  }),
  globalPrefix: 'api',
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(['SIGINT', 'SIGTERM']),
});
await app.listen();
```

Listen 전 설정이 필요하면 같은 Factory 생성 뒤 설정을 마치고 `app.listen()`을 호출하세요. Signal callback을 생략하면 host가 `app.close()`를 직접 소유합니다.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({
    port: 3000,
  }),
  logger: createConsoleApplicationLogger(),
});
await app.listen();

// When the host requests shutdown:
await app.close();
```

`NodeHttpApplicationAdapter.create(options)`와 `FluoFactory.create(...)`로 앱을 생성한 뒤 `app.listen()`을 호출합니다. Node console logger와 `createNodeShutdownSignalRegistration()` callback을 명시적으로 선택하세요. Signal 종료의 `forceExitTimeoutMs` 초과 또는 실패는 log와 `process.exitCode`로 보고하며 최종 process 종료는 host가 소유합니다. Adapter의 `shutdownTimeoutMs`는 별도의 connection drain bound입니다.

## 동작 계약

- `NodeHttpApplicationAdapter.create(options)`는 Node 내장 `http` 또는 `https` 서버 primitive 위에서 fluo를 직접 실행하는 adapter-first 진입점입니다.
- `http`는 plain HTTP server 생성용 Node `node:http` `ServerOptions`를 받고, `https`는 기존 TLS 생성 option을 유지합니다. 호출자는 두 field 중 하나만 제공해야 합니다.
- `maxBodySize`는 0 이상의 정수 바이트 수만 받으며, raw Node 요청 바이트가 아직 스트리밍되는 동안 강제되고, adapter options에서 `multipart.maxTotalSize`를 명시적으로 제공하지 않으면 멀티파트 전체 크기 한도의 기본값이 됩니다.
- Raw Node adapter는 대소문자가 섞인 JSON 및 multipart `content-type` 값을 normalize하고, request body가 `maxBodySize`를 넘으면 `413`을 반환하며, `x-request-id`와 `x-correlation-id` fallback을 request context와 error response에 전파하고, `getServer()` / `getRealtimeCapability()`를 통해 server-backed realtime capability를 노출합니다.
- 지원되는 Node logger, shutdown, filesystem, raw adapter helper는 package root에 있고 저수준 request/response/compression plumbing은 `@fluojs/platform-nodejs/internal`에 있습니다.

## Conformance 커버리지

`packages/platform-nodejs/src/adapter-create.test.ts`, `packages/platform-nodejs/src/published-declaration-surface.test.ts`, `packages/platform-nodejs/src/index.test.ts`, `packages/platform-nodejs/src/lifecycle.test.ts`, `packages/platform-nodejs/src/lifecycle.integration.test.ts`는 문서화된 Node.js 계약을 위한 package-local regression target입니다. Adapter portability suite는 공유 `createHttpAdapterPortabilityHarness(...)` 검사를 실행하여 malformed cookie 보존, JSON/text raw-body capture, byte-exact raw-body capture, 단일 byte-range status/header/body semantic, multipart raw-body 제외, multipart 전체 크기 기본값, SSE framing, response stream drain settlement, host 및 HTTPS startup logging, shutdown signal listener cleanup을 검증합니다.

이 패키지는 `HttpApplicationAdapter`를 노출하며 `platform.components`에 등록되는 runtime-managed `PlatformComponent`가 아닙니다. 따라서 generic `createPlatformConformanceHarness(...)` component lifecycle 검사는 이 패키지의 지원 계약 범위에 포함되지 않고, `createHttpAdapterPortabilityHarness(...)`가 적용되는 공유 harness입니다.

같은 regression target들은 package-specific public surface, canonical static creation, adapter-first startup, plain HTTP 생성 option과 HTTPS conflict boundary, lifecycle option validation, 실제로 관찰되는 listen retry, active-request bounded drain, 정상 및 실패 signal-driven shutdown, `process.env.PORT` isolation, zero/default `maxBodySize` boundary, idle keep-alive shutdown, 대소문자가 섞인 JSON 및 multipart content-type parsing, `x-correlation-id` request ID fallback, server-backed realtime capability 노출도 함께 다룹니다. Startup behavior를 바꿀 때는 README 예제 포인터를 아래 테스트 파일 및 Node.js 챕터 예제와 맞춰 유지하세요.

## 공개 API 개요

- `NodeHttpApplicationAdapter.create(options)`: raw Node.js HTTP 어댑터를 위한 기본 팩토리입니다.
- `NodeHttpAdapterOptions`: `compression`, `multipart`, `port`, `host`, 상호 배타적인 `http` 또는 `https` 생성 option, `maxBodySize`, retry 설정, raw body 보존, shutdown timeout을 포함하는 `NodeHttpApplicationAdapter.create(...)`의 transport-level 옵션입니다.
- `app.listen()`의 retry는 `retryLimit`/`retryDelayMs`를 따릅니다. Adapter close는 bounded drain 전에 idle keep-alive connection을 닫습니다.
- `NodeShutdownSignal`: Node shutdown callback이 지원하는 `SIGINT`와 `SIGTERM` 타입입니다.
- `NodeHttpApplicationAdapter`: `create(...)`의 구체적인 반환 타입이자 기존 DI class token입니다. `instanceof`, 상속, public positional constructor 및 instance `listen`/`close`는 유지됩니다.
- Node bootstrap/run, logger, signal, filesystem export는 유지됩니다. 삭제된 adapter factory와 타입 별칭은 migration guide를 참고하세요.
- `@fluojs/platform-nodejs/internal`: `@fluojs/runtime/internal-node`를 대체하는 first-party Node adapter integration seam이며 저수준 compression 및 request/response helper를 포함합니다.

## Multipart 스트리밍

`multipart`는 계속 adapter가 소유하며 Factory 자체에는 `multipart` option이 없습니다.

`NodeHttpApplicationAdapter.create(...)`에 `multipart: { strategy: 'stream' }`을 설정하면 multipart part가 `RequestContext.request.body`의 `AsyncIterable`로 노출됩니다. Node listener는 iterator를 미리 읽거나 버퍼링하지 않으며, file part를 소비할 때만 바이트를 가져옵니다. 버퍼링 multipart parsing은 기본값이며 fields와 `request.files`를 노출하고, 하나의 request body에서 stream 소비와 함께 사용할 수 없습니다.

Runtime route dispatch는 route를 위해 만든 iterator를 소유하며 handler가 끝난 뒤 자동으로 `return()`을 호출해 active source를 cancel하고 release합니다. Standalone `parseMultipartStream(...)` consumer는 이 책임을 직접 집니다. iterator를 끝까지 소비하거나 일찍 끝낼 때 `return()`을 호출하세요.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임 facade입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.
- `@fluojs/http`: 공통 HTTP 추상화 및 데코레이터를 포함합니다.

## 예제 소스

- `packages/platform-nodejs/src/index.test.ts`
- `packages/platform-nodejs/src/lifecycle.test.ts`
- `packages/platform-nodejs/src/lifecycle.integration.test.ts`
- `book/intermediate/ch21-express-node.ko.md`

`createNodeShutdownSignalRegistration(...)`은 부분 등록 실패 시 설치된 handler를 rollback하며 개별 해제가 실패해도 나머지를 모두 시도합니다. Factory close는 해제 실패를 동시·이후 caller에 유지하지만 runtime 자원 정리는 계속합니다. `factory-signals.test.ts`가 이를 검증합니다. 새 앱은 위 Factory recipe와 [migration 안내](../../docs/getting-started/migrate-http-factory.ko.md)를 사용하세요.
