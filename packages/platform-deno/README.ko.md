# @fluojs/platform-deno

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

네이티브 `Deno.serve`를 기반으로 구축된 fluo 런타임용 Deno 기반 HTTP 어댑터 패키지입니다.

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
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

## 사용 시점

fluo 애플리케이션을 [Deno](https://deno.com/) 런타임에서 실행할 때 이 패키지를 사용합니다. 이 어댑터는 Deno의 네이티브 `fetch` 표준 `Request` 및 `Response` 객체를 활용하여 TypeScript 백엔드 개발을 위한 안전하고 고성능인 환경을 제공합니다.

애플리케이션 종료 중에는 새 유입을 중단하고, Deno 서버 수명주기가 종료되기 전에 활성 HTTP 핸들러가 bounded drain window 안에서 마무리될 수 있도록 동작합니다.

## 빠른 시작

```typescript
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## 주요 패턴

### 수동 요청 디스패칭
테스트나 커스텀 `Deno.serve` 구현을 위해 어댑터의 `handle` 메서드를 사용하여 네이티브 웹 요청을 수동으로 디스패치할 수 있습니다.

```typescript
const adapter = createDenoAdapter({ port: 3000 });
const response = await adapter.handle(new Request('http://localhost:3000/health'));
```

### Deno 네이티브 WebSocket 지원
어댑터는 `@fluojs/websockets/deno` 바인딩을 통해 Deno의 네이티브 `Deno.upgradeWebSocket`을 지원합니다.

```typescript
// Deno 어댑터가 활성화된 경우 게이트웨이는 자동으로 Deno의 네이티브 업그레이드를 사용합니다.
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## 공개 API 개요

- `createDenoAdapter(options)`: Deno HTTP 어댑터를 위한 팩토리입니다.
- `bootstrapDenoApplication(module, options)`: 커스텀 오케스트레이션을 위한 고급 부트스트랩입니다.
- `runDenoApplication(module, options)`: Deno를 위한 권장 빠른 시작 헬퍼입니다.
- `handle(request)`: 수동 `Request` to `Response` 디스패처입니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/deno`를 포함합니다.
- `@fluojs/http`: HTTP 데코레이터 및 추상화 계층입니다.

## 예제 소스

- `packages/platform-deno/src/adapter.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
