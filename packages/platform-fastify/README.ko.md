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
Fastify 어댑터는 내부 Fastify 플러그인을 통해 멀티파트 form-data 및 raw body 파싱을 기본적으로 지원하며, 이는 표준 fluo 요청 인터페이스를 통해 노출됩니다. 어댑터를 직접 생성할 때는 멀티파트 제한을 두 번째 인자로 전달하고, `bootstrapFastifyApplication(...)` 및 `runFastifyApplication(...)`에서는 같은 설정을 `options.multipart` 아래에 전달하면 됩니다.

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

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/platform-express`: 대안 Express 기반 어댑터입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.

## 예제 소스

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`
