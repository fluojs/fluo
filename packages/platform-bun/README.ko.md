# @fluojs/platform-bun

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

네이티브 `Bun.serve()`를 기반으로 구축된 fluo 런타임용 Bun 기반 HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [어댑터 계약](#어댑터-계약)
- [Conformance 커버리지](#conformance-커버리지)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-bun
```

이 패키지는 Bun에서 실행하는 것을 전제로 합니다. 배포 manifest는 npm 메타데이터가 Bun 런타임 계약과 어긋나지 않도록 의도적으로 `engines.node`를 선언하지 않으며, 저장소의 Node.js 20+ 요구사항은 메인테이너용 빌드/테스트 툴체인에만 적용됩니다.

## 사용 시점

fluo 애플리케이션을 [Bun](https://bun.sh/) 런타임에서 실행할 때 이 패키지를 사용합니다. 이 어댑터는 Bun의 고성능 `Request`/`Response` 브리지와 네이티브 `fetch` 방식의 아키텍처를 활용하여 Bun 사용자에게 원활하고 빠른 경험을 제공합니다.

애플리케이션 종료 중에는 새 유입을 중단하고, Bun이 서버를 강제로 내리기 전에 활성 HTTP 핸들러가 bounded drain window 안에서 마무리될 수 있도록 동작합니다. 시그널 기반 종료가 `forceExitTimeoutMs`를 넘기거나 실패하면 fluo는 그 상태를 로그와 `process.exitCode`로 보고하고, 최종 프로세스 종료는 Bun 또는 주변 호스트에 맡깁니다.

## 빠른 시작

```typescript
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 수동 Fetch 처리
Bun 서버를 직접 관리하려는 경우 fetch 핸들러를 직접 사용할 수 있습니다.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### 네이티브 WebSocket 업그레이드
어댑터는 `@fluojs/websockets/bun` 바인딩을 통해 Bun의 네이티브 `server.upgrade()`를 지원합니다.

```typescript
// Bun 어댑터가 활성화된 경우 게이트웨이는 자동으로 Bun의 네이티브 업그레이드를 사용합니다.
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## 공개 API 개요

- `createBunAdapter(options)`: Bun 어댑터를 위한 권장 팩토리입니다.
- `createBunFetchHandler(options)`: 커스텀 `Bun.serve()` 설정을 위한 네이티브 `fetch(request)` 핸들러를 생성합니다.
- `bootstrapBunApplication(module, options)`: 암시적 시작 로그 없이 애플리케이션을 부트스트랩하는 고급 헬퍼입니다.
- `runBunApplication(module, options)`: 시그널 연결을 포함한 빠른 시작을 위한 호환 헬퍼입니다.

어댑터는 realtime 패키지가 사용하는 타입 지정 Bun 통합 seam도 함께 내보냅니다.

- `BunHttpApplicationAdapter`: `Bun.serve()`를 기반으로 동작하는 `HttpApplicationAdapter` 구현체입니다.
- `BunAdapterOptions`: `createBunAdapter()`가 받는 host, port, TLS, raw-body, multipart, shutdown 옵션입니다.
- `BootstrapBunApplicationOptions` 및 `RunBunApplicationOptions`: Bun 호스팅 애플리케이션의 bootstrap/run 옵션입니다.
- `BunWebSocketBinding` 및 `BunRealtimeBindingHost`: 일반 HTTP dispatch 전에 `@fluojs/websockets/bun`이 사용하는 binding 계약입니다.

## 어댑터 계약

- **런타임 host**: 이 패키지는 listen 시점에 `globalThis.Bun.serve()`가 필요합니다. 테스트에서는 Bun 호환 test double을 제공할 수 있지만, production 사용은 Bun 전용입니다.
- **요청 portability**: Fetch 요청은 shared web dispatcher를 통해 변환되며 malformed cookie 값, query 배열, `rawBody: true`일 때 JSON/text raw body, SSE framing을 보존합니다.
- **Multipart 동작**: Multipart 요청은 `rawBody`를 노출하지 않으며 multipart limit은 shared runtime parser를 통해 계속 적용됩니다.
- **시작 target**: `hostname`, `port`, `tls`는 `Bun.serve()`로 전달됩니다. 시작 로그는 설정된 HTTP 또는 HTTPS listen URL을 보고합니다.
- **종료 소유권**: `close()`는 새 유입을 중단하고, in-flight HTTP handler를 기다린 뒤, drain이 끝나면 adapter state를 정리하며 `runBunApplication()`이 등록한 signal listener를 제거합니다.
- **Realtime seam**: Bun websocket binding은 서버를 시작하는 `listen()` 전에 구성해야 합니다. Upgrade 요청은 HTTP dispatch로 넘어가기 전에 구성된 binding에 먼저 전달됩니다.

## Conformance 커버리지

`packages/platform-bun/src/adapter.test.ts`는 문서화된 계약을 검증하는 package-local regression 대상입니다. 이 파일은 malformed cookie, JSON/text raw-body 보존, multipart raw-body 제외, SSE framing을 검증하는 Bun fetch-style portability assertion과 startup logging, shutdown listener cleanup, in-flight drain, timeout reporting, websocket binding delegation을 검증하는 집중 테스트를 포함합니다.

저장소의 더 넓은 suite도 `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`에서 `createWebRuntimeHttpAdapterPortabilityHarness(...)`로 Bun을 Deno 및 Cloudflare Workers와 함께 실행해 fetch-style platform 간 shared web-runtime portability baseline을 맞춥니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/bun`을 포함합니다.
- `@fluojs/socket.io`: 네이티브 Bun 엔진을 지원합니다.

## 예제 소스

- `packages/platform-bun/src/adapter.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
