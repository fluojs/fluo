# @fluojs/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 raw Node.js HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
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

이 패키지는 Node.js `>=20.19.3 <21 || >=22.2.0 <27`을 대상으로 합니다. Node 20.19.3 미만, Node 21, Node 22.2.0 미만은 listener-level RFC `QUERY` 요청을 request event로 일관되게 노출하지 못하고 검증되지 않은 Node 27 이상은 광고하지 않으므로, 게시된 package manifest는 이 정확한 `engines.node` 범위를 선언합니다. Raw 어댑터는 비 Node fetch-style host가 아니라 Node.js `http`/`https` server primitive에 의존합니다.

## 사용 시점

Express나 Fastify와 같은 중간 프레임워크의 오버헤드 없이 Node.js 내장 `http` 또는 `https` 모듈에서 직접 fluo 애플리케이션을 실행하려는 경우에 사용합니다. 최소한의 리소스 사용, 저수준 최적화 또는 표준 Node API가 선호되는 환경에 이상적입니다.

## 빠른 시작

```typescript
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### Early Hints

Raw Node response는 `context.response.earlyHints`를 노출합니다. 이 optional capability를 확인한 뒤 HTTP `103` 하나마다 `write(...)`를 await하세요. 여러 write를 지원합니다. 각 write에는 비어 있지 않은 `link` value가 필요하며 Node가 허용하는 다른 informational field도 포함할 수 있습니다. Native write는 final response를 commit하거나 early field를 final header로 복사하지 않습니다. Late/native failure는 `EarlyHintsWriteError`로 reject되고 settlement 전에 연결이 끊기면 `RequestAbortedError`로 reject됩니다.

### 서버 옵션 커스텀
어댑터는 문서화된 Node.js transport 옵션인 host/port 바인딩, plain HTTP 또는 HTTPS 생성 설정, request body 제한, raw-body 보존, listen retry 설정, shutdown drain bound를 제공합니다.

```typescript
const adapter = createNodejsAdapter({
  port: 3000,
  http: {
    maxHeaderSize: 16_384,
    joinDuplicateHeaders: true,
  },
  maxBodySize: 1_048_576,
});
```

`http`는 Node의 `node:http` `ServerOptions`를 받고 listener가 시작되기 전에 `createServer(options, handler)`로 전달합니다. `maxHeaderSize`, `insecureHTTPParser`, `joinDuplicateHeaders`, `highWaterMark` 같은 생성 시점 설정에 사용하세요. TLS에는 Node HTTPS server option이 담긴 `https`를 대신 제공하세요. `http`와 `https`는 동시에 사용할 수 없으며, 둘 다 제공하면 adapter가 server를 만들기 전에 throw하므로 어느 option도 조용히 무시되지 않습니다.

`maxBodySize`는 바이트 수를 나타내는 숫자만 받습니다. 이 값은 raw Node 요청 바디가 아직 스트리밍되는 동안 바로 강제되며, 부트스트랩 시 `multipart.maxTotalSize`를 따로 재정의하지 않으면 같은 값이 멀티파트 전체 페이로드 한도의 기본값으로도 사용됩니다.

`createNodejsAdapter()`는 기본 port로 `3000`을 사용하고 `process.env.PORT`를 무시하며, `port`, `maxBodySize`, `retryDelayMs`, `retryLimit`, adapter-level `shutdownTimeoutMs`가 잘못되면 throw합니다. 기본 request body cap은 `1 MiB`입니다.

### 직접 애플리케이션 실행
`runNodejsApplication`을 사용하여 graceful shutdown 및 로깅이 포함된 보일러플레이트 없는 시작이 가능합니다.

시그널 기반 종료가 run-helper `forceExitTimeoutMs`를 넘기거나 실패하면 헬퍼는 해당 상태를 로그와 `process.exitCode`로 보고하지만, 최종 프로세스 종료는 호스트 프로세스 소유자에게 맡깁니다. Connection drain bound에는 adapter-level `shutdownTimeoutMs`를, signal handler completion bound에는 run-helper `forceExitTimeoutMs`를 사용하세요.

`bootstrapNodejsApplication(...)`과 `runNodejsApplication(...)`은 framework console logger를 기본으로 사용합니다. host나 portability test가 startup/shutdown diagnostics를 주입된 `ApplicationLogger`로 캡처해야 할 때는 `logger`를 전달하세요.

```typescript
import { runNodejsApplication } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

await runNodejsApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

Listener를 시작하지 않고 애플리케이션만 만들고 싶다면 `bootstrapNodejsApplication(...)`을 사용하세요:

```typescript
const app = await bootstrapNodejsApplication(AppModule, { port: 3000 });
await app.listen();
```

## 동작 계약

- `createNodejsAdapter(options)`는 Node 내장 `http` 또는 `https` 서버 primitive 위에서 fluo를 직접 실행하는 adapter-first 진입점입니다.
- `http`는 plain HTTP server 생성용 Node `node:http` `ServerOptions`를 받고, `https`는 기존 TLS 생성 option을 유지합니다. 호출자는 두 field 중 하나만 제공해야 합니다.
- `maxBodySize`는 0 이상의 정수 바이트 수만 받으며, raw Node 요청 바이트가 아직 스트리밍되는 동안 강제되고, 부트스트랩/실행 헬퍼에서 `multipart.maxTotalSize`를 명시적으로 제공하지 않으면 멀티파트 전체 크기 한도의 기본값이 됩니다.
- Raw Node adapter는 대소문자가 섞인 JSON 및 multipart `content-type` 값을 normalize하고, request body가 `maxBodySize`를 넘으면 `413`을 반환하며, `x-request-id`와 `x-correlation-id` fallback을 request context와 error response에 전파하고, `getServer()` / `getRealtimeCapability()`를 통해 server-backed realtime capability를 노출합니다.
- `bootstrapNodejsApplication(module, options)`는 raw Node 어댑터가 포함된 애플리케이션을 만들지만 리스닝은 시작하지 않으므로 이후 `app.listen()`과 `app.close()` 생명주기는 호출자가 소유합니다.
- `runNodejsApplication(module, options)`는 부트스트랩, 리스닝 시작, graceful shutdown 배선을 함께 수행합니다. Listen retry는 `retryLimit`/`retryDelayMs`를 따르고, shutdown은 bounded drain 전에 idle keep-alive connection을 닫으며, 시그널 기반 종료가 타임아웃되거나 실패하면 해당 상태를 로그와 `process.exitCode`로 보고합니다. 최종 프로세스 종료는 호스트 프로세스가 계속 소유합니다.
- 고급 압축 및 shutdown 유틸리티 함수는 이 기본 platform startup surface가 아니라 `@fluojs/runtime/node` 또는 runtime 내부 seam에 남아 있습니다.

## Conformance 커버리지

`packages/platform-nodejs/src/index.test.ts`와 `packages/platform-nodejs/src/lifecycle.test.ts`는 문서화된 Node.js 계약을 위한 package-local regression target입니다. Adapter portability suite는 공유 `createHttpAdapterPortabilityHarness(...)` 검사를 실행하여 malformed cookie 보존, JSON/text raw-body capture, byte-exact raw-body capture, 단일 byte-range status/header/body semantic, multipart raw-body 제외, multipart 전체 크기 기본값, SSE framing, response stream drain settlement, host 및 HTTPS startup logging, shutdown signal listener cleanup을 검증합니다.

이 패키지는 `HttpApplicationAdapter`를 노출하며 `platform.components`에 등록되는 runtime-managed `PlatformComponent`가 아닙니다. 따라서 generic `createPlatformConformanceHarness(...)` component lifecycle 검사는 이 패키지의 지원 계약 범위에 포함되지 않고, `createHttpAdapterPortabilityHarness(...)`가 적용되는 공유 harness입니다.

같은 regression target들은 package-specific public surface, type alias, adapter-first startup, plain HTTP 생성 option과 HTTPS conflict boundary, lifecycle option validation, 실제로 관찰되는 listen retry, active-request bounded drain, 정상 및 실패 signal-driven shutdown, `process.env.PORT` isolation, zero/default `maxBodySize` boundary, idle keep-alive shutdown, 대소문자가 섞인 JSON 및 multipart content-type parsing, `x-correlation-id` request ID fallback, server-backed realtime capability 노출도 함께 다룹니다. Startup behavior를 바꿀 때는 README 예제 포인터를 아래 테스트 파일 및 Node.js 챕터 예제와 맞춰 유지하세요.

## 공개 API 개요

- `createNodejsAdapter(options)`: raw Node.js HTTP 어댑터를 위한 기본 팩토리입니다.
- `bootstrapNodejsApplication(module, options)`: 리스너를 시작하지 않고 애플리케이션 인스턴스를 생성합니다.
- `runNodejsApplication(module, options)`: 생명주기 관리를 포함하여 애플리케이션을 부트스트랩하고 시작합니다.
- `BootstrapNodejsApplicationOptions`: bootstrap-only Node.js 애플리케이션 생성 옵션입니다.
- `NodejsAdapterOptions`: `port`, `host`, 상호 배타적인 `http` 또는 `https` 생성 option, `maxBodySize`, retry 설정, raw body 보존, shutdown timeout을 포함하는 `createNodejsAdapter(...)`의 transport-level 옵션입니다.
- `NodejsApplicationSignal`: `runNodejsApplication(...)` shutdown 등록이 지원하는 시그널 이름입니다.
- `NodejsHttpApplicationAdapter`: `createNodejsAdapter(...)`가 반환하는 어댑터 인스턴스를 설명하는 타입 전용 별칭이며, `@fluojs/runtime/node`가 공개하는 어댑터 surface를 그대로 보존합니다.
- `RunNodejsApplicationOptions`: 부트스트랩, 리스닝 시작, graceful shutdown 배선을 한 번에 수행하기 위한 옵션입니다.

## Multipart 스트리밍

애플리케이션 생성 시 `multipart: { strategy: 'stream' }`을 설정하면 multipart part가 `RequestContext.request.body`의 `AsyncIterable`로 노출됩니다. Node listener는 iterator를 미리 읽거나 버퍼링하지 않으며, file part를 소비할 때만 바이트를 가져옵니다. 버퍼링 multipart parsing은 기본값이며 fields와 `request.files`를 노출하고, 하나의 request body에서 stream 소비와 함께 사용할 수 없습니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임 facade입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.
- `@fluojs/http`: 공통 HTTP 추상화 및 데코레이터를 포함합니다.

## 예제 소스

- `packages/platform-nodejs/src/index.test.ts`
- `packages/platform-nodejs/src/lifecycle.test.ts`
- `book/intermediate/ch21-express-node.ko.md`
