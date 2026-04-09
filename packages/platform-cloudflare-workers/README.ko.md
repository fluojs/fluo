# @konekti/platform-cloudflare-workers

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

엣지에 최적화된 Konekti 런타임용 Cloudflare Workers HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/platform-cloudflare-workers
```

## 사용 시점

Konekti 애플리케이션을 [Cloudflare Workers](https://workers.cloudflare.com/)에 배포할 때 이 패키지를 사용합니다. 이 어댑터는 서버리스 엣지 환경에 맞게 설계되었으며, Worker isolate 제약 조건과 네이티브 Web API를 준수하는 가벼운 `fetch` 기반 어댑터를 제공합니다.

## 빠른 시작

### 표준 어댑터 사용
애플리케이션을 부트스트랩하고 표준 Cloudflare Worker `fetch` 핸들러를 내보냅니다.

```typescript
import { KonektiFactory } from '@konekti/runtime';
import { createCloudflareWorkerAdapter } from '@konekti/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter();
const app = await KonektiFactory.create(AppModule, { adapter });

await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

### 지연 엔트리포인트 (Zero-Config)
첫 번째 요청 시 부트스트랩을 수행하는 엔트리포인트 헬퍼를 사용하여 설정을 더욱 간소화할 수 있습니다.

```typescript
import { createCloudflareWorkerEntrypoint } from '@konekti/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## 주요 패턴

### WebSocketPair 활용
어댑터는 `@konekti/websockets/cloudflare-workers` 바인딩을 통해 실시간 통신을 위한 Cloudflare의 네이티브 `WebSocketPair`를 지원합니다.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### 엣지 네이티브 미들웨어
표준 Konekti 미들웨어(CORS, Global Prefix 등)가 완전히 지원되며 Cloudflare 환경에 최적화되어 있습니다.

```typescript
const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});
```

## 공개 API 개요

- `createCloudflareWorkerAdapter(options)`: Worker HTTP 어댑터를 위한 팩토리입니다.
- `createCloudflareWorkerEntrypoint(module, options)`: 지연 부트스트랩 방식의 Worker 엔트리포인트를 생성합니다.
- `bootstrapCloudflareWorkerApplication(module, options)`: Worker를 위한 비동기 부트스트랩 헬퍼입니다.
- `CloudflareWorkerHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.

## 관련 패키지

- `@konekti/runtime`: 핵심 런타임입니다.
- `@konekti/websockets`: 전용 서브패스 `@konekti/websockets/cloudflare-workers`를 포함합니다.
- `@konekti/http`: 공통 HTTP 데코레이터 계층입니다.

## 예제 소스

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`

