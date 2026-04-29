# @fluojs/platform-fastify

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 Fastify 기반 HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [성능](#성능)
- [공개 API 개요](#공개-api-개요)
- [트러블슈팅](#트러블슈팅)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-fastify fastify
```

## 사용 시점

fluo 애플리케이션을 위한 고성능 HTTP 어댑터가 필요한 경우 이 패키지를 사용합니다. Fastify는 낮은 오버헤드와 효율적인 요청 처리로 잘 알려져 있으며, 높은 처리량과 동시성이 요구되는 프로덕션 fluo 애플리케이션에 권장되는 선택입니다.

## 빠른 시작

```typescript
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 멀티파트 및 Raw Body
Fastify 어댑터는 내부 Fastify 플러그인을 통해 멀티파트 form-data 및 raw body 파싱을 기본적으로 지원하며, 이는 표준 fluo 요청 인터페이스를 통해 노출됩니다. `rawBody: true`를 활성화하면 멀티파트가 아닌 요청에서 `FrameworkRequest.rawBody`가 원본 요청 바이트를 그대로 보존하므로 webhook 서명 검증이나 기타 바이트 민감한 흐름에서 정확한 payload를 다시 사용할 수 있습니다. 어댑터를 직접 생성할 때는 멀티파트 제한을 두 번째 인자로 전달하고, `bootstrapFastifyApplication(...)` 및 `runFastifyApplication(...)`에서는 같은 설정을 `options.multipart` 아래에 전달하면 됩니다.

```typescript
const adapter = createFastifyAdapter(
  {
    port: 3000,
    rawBody: true,
  },
  {
    maxTotalSize: 10 * 1024 * 1024,
  },
);
```

### 서버 기반 실시간 통신 (Real-Time)
Fastify는 `@fluojs/websockets`가 기본 Node.js HTTP 서버에 직접 연결될 수 있도록 `server-backed` 기능을 제공합니다.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### 스트리밍 응답
Fastify 기반 응답 스트림은 SSE 및 기타 스트리밍 writer가 사용하는 공통 fluo 스트림 계약을 지원합니다. `response.stream.waitForDrain()`은 기본 응답이 `drain`, `close`, 또는 `error`를 내보낼 때 settle되므로, 클라이언트가 연결을 끊거나 backpressure가 해소되기 전에 스트림이 닫혀도 writer가 멈춰 있지 않습니다.

### CORS 설정
CORS는 부트스트랩 옵션을 통해 처리됩니다. fluo는 별도의 Fastify 플러그인에 의존하지 않고 내부 CORS 로직을 관리합니다.

```typescript
// 단순 origin 문자열 설정
await bootstrapFastifyApplication(AppModule, {
  cors: 'https://my-frontend.com',
  port: 3000,
});

// 세부 설정
await bootstrapFastifyApplication(AppModule, {
  cors: {
    origin: ['https://a.com', 'https://b.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
  port: 3000,
});

// 명시적으로 비활성화
await bootstrapFastifyApplication(AppModule, {
  cors: false,
  port: 3000,
});
```

### 글로벌 접두사 (Global Prefix)
라우팅 접두사를 전역으로 설정하고, 헬스 체크와 같은 특정 경로는 제외할 수 있습니다.

```typescript
await bootstrapFastifyApplication(AppModule, {
  globalPrefix: '/api',
  globalPrefixExclude: ['/health'],
  port: 3000,
});
```

### 로깅 (Logging)
fluo는 자체 로깅 시스템을 사용합니다. 어댑터는 Fastify 인스턴스를 생성할 때 네이티브 로거를 비활성화하며, 부트스트랩 옵션에 제공된 fluo 로거를 통해 로그를 기록합니다.

```typescript
await runFastifyApplication(AppModule, {
  logger: myLogger,
  port: 3000,
});
```

### 미들웨어 (Middleware)
요청이 핸들러에 도달하기 전에 실행되는 런타임 레벨의 미들웨어를 등록할 수 있습니다. 이는 Fastify 전용 플러그인이 아닌 표준 `MiddlewareLike` 함수라는 점에 유의하세요.

```typescript
await bootstrapFastifyApplication(AppModule, {
  middleware: [myCustomMiddleware],
  port: 3000,
});
```

### 네이티브 라우트 등록과 안전한 폴백
fluo 라우트 메타데이터를 Fastify 경로로 그대로 옮길 수 있는 경우, 어댑터는 모든 요청을 단일 와일드카드 라우트로 보내는 대신 Fastify 네이티브 per-route 핸들러를 등록합니다. 의미 보존이 가능한 unversioned route에서는 Fastify가 미리 고른 descriptor와 params를 공유 fluo dispatcher에 전달하므로 duplicate route matching을 건너뛰면서도 middleware, guards, interceptors, observers, SSE, multipart, raw body, streaming, error handling 의미론은 그대로 유지됩니다.

여러 라우트가 같은 method와 정규화된 param shape를 공유하는 경우(예: `/:id` 와 `/:slug`), `@All(...)`을 사용하는 경우, non-URI versioning에 의존하는 경우, 또는 duplicate slash / trailing slash 변형으로 들어온 경우에는 어댑터가 해당 요청을 의도적으로 와일드카드 fallback 경로에 남겨 둡니다. 이렇게 해서 Fastify 등록 단계에서 부팅 실패가 나거나 fluo의 등록 순서 기반 매칭 의미론이 좁아지지 않도록 보장합니다. app middleware가 native handoff 이후 framework request의 method 또는 path를 rewrite하면 dispatcher는 stale handoff를 무시하고 rewrite된 요청을 다시 매칭합니다.

어댑터는 매칭되지 않은 경로와 이식성에 민감한 경우를 위해 와일드카드 fallback 라우트를 계속 유지하며, Fastify의 trailing slash / duplicate slash 정규화를 켜서 네이티브 선택 경로도 fluo의 문서화된 route path 계약과 맞추어 동작하도록 합니다. CORS 처리는 Fastify 플러그인이 아니라 fluo의 공유 middleware 경로가 계속 소유하고, `OPTIONS` 같은 미지원 메서드는 fluo route가 명시적으로 소유하지 않는 한 fallback dispatcher 경로로 흐릅니다.

## 성능

fluo의 Fastify 어댑터는 높은 동시성 시나리오에서 raw Node.js 어댑터보다 훨씬 뛰어난 성능을 발휘합니다.

| 어댑터 | 초당 요청 수 (Req/sec) | 평균 지연 시간 (Avg Latency) |
| --- | ---: | ---: |
| Raw Node.js 어댑터 | ~31,000 | 4.0ms |
| Fastify 어댑터 | **~58,000** | **2.1ms** |

*표준 `/health` 엔드포인트에서 `wrk`를 사용하여 측정되었습니다.*

## 공개 API 개요

- `createFastifyAdapter(options)`: Fastify 어댑터를 위한 권장 팩토리입니다.
- `bootstrapFastifyApplication(module, options)`: 암시적 리스닝 없이 수행하는 고급 부트스트랩입니다.
- `runFastifyApplication(module, options)`: 생명주기 관리를 포함한 빠른 시작 헬퍼입니다. timeout/실패 시에는 해당 상태를 로그와 `process.exitCode`로 보고하고, 최종 프로세스 종료는 주변 호스트에 맡깁니다.
- `FastifyHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.

## 트러블슈팅

- **CORS 오류**: `cors` 부트스트랩 옵션을 사용 중인지 확인하세요. Fastify의 네이티브 CORS 플러그인을 사용하지 않으므로 오직 fluo가 관리하는 CORS 로직만 적용됩니다.
- **미들웨어 문제**: `middleware` 옵션은 런타임 레벨의 `MiddlewareLike[]` 함수 배열을 받습니다. 이는 Fastify 플러그인이 아니며 다른 fluo 어댑터들과 공통으로 사용되는 표준 인터페이스를 따릅니다.
- **로깅 (Logging)**: 로그 스트림 중복을 방지하기 위해 Fastify의 네이티브 로거가 비활성화됩니다. 모든 로깅 설정은 `runFastifyApplication` 또는 `bootstrapFastifyApplication`의 `logger` 옵션을 통해 이루어져야 합니다.
- **글로벌 접두사 (Global Prefix)**: 내부 경로 또는 헬스 체크 엔드포인트에 접두사가 붙지 않도록 `globalPrefixExclude`를 적절히 설정하세요.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/platform-express`: 대안 Express 기반 어댑터입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.

## 예제 소스

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`
