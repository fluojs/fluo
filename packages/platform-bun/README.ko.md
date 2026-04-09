# @konekti/platform-bun

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

네이티브 `Bun.serve()`를 기반으로 구축된 Konekti 런타임용 Bun 기반 HTTP 어댑터 패키지입니다.

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
npm install @konekti/platform-bun
```

## 사용 시점

Konekti 애플리케이션을 [Bun](https://bun.sh/) 런타임에서 실행할 때 이 패키지를 사용합니다. 이 어댑터는 Bun의 고성능 `Request`/`Response` 브리지와 네이티브 `fetch` 방식의 아키텍처를 활용하여 Bun 사용자에게 원활하고 빠른 경험을 제공합니다.

애플리케이션 종료 중에는 새 유입을 중단하고, Bun이 서버를 강제로 내리기 전에 활성 HTTP 핸들러가 bounded drain window 안에서 마무리될 수 있도록 동작합니다.

## 빠른 시작

```typescript
import { createBunAdapter } from '@konekti/platform-bun';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 수동 Fetch 처리
Bun 서버를 직접 관리하려는 경우 fetch 핸들러를 직접 사용할 수 있습니다.

```typescript
import { createBunFetchHandler } from '@konekti/platform-bun';

const handler = await createBunFetchHandler({ 
  dispatcher: app.getHttpDispatcher(),
  port: 3000 
});

Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### 네이티브 WebSocket 업그레이드
어댑터는 `@konekti/websockets/bun` 바인딩을 통해 Bun의 네이티브 `server.upgrade()`를 지원합니다.

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

## 관련 패키지

- `@konekti/runtime`: 핵심 런타임입니다.
- `@konekti/websockets`: 전용 서브패스 `@konekti/websockets/bun`을 포함합니다.
- `@konekti/socket.io`: 네이티브 Bun 엔진을 지원합니다.

## 예제 소스

- `packages/platform-bun/src/adapter.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
