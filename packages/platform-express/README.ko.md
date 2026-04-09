# @konekti/platform-express

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임을 위한 Express 기반 HTTP 어댑터 패키지입니다.

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
npm install @konekti/platform-express express
```

## 사용 시점

Konekti 애플리케이션의 기본 HTTP 엔진으로 Express를 사용하려는 경우에 이 패키지를 사용합니다. 이는 Konekti의 데코레이터 기반 아키텍처 내에서 Express의 강력한 생태계, 성숙한 Node.js 서버 처리 및 친숙한 요청/응답 생명주기를 활용하는 데 유용합니다.

## 빠른 시작

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 스트리밍 응답 처리 (SSE)
Express 어댑터는 공유 `SseResponse` 유틸리티를 통해 Server-Sent Events(SSE)를 지원하며, Express 전용 스트림 처리를 추상화합니다.

```typescript
@Get('events')
async streamEvents(@Res() res: FrameworkResponse) {
  const events = new SseResponse();
  events.send({ data: 'hello' });
  return events;
}
```

### 바디 파싱 및 멀티파트
어댑터 옵션에서 설정하면 `rawBody` 및 멀티파트 form-data 파싱을 즉시 사용할 수 있습니다.

```typescript
const adapter = createExpressAdapter({
  port: 3000,
  rawBody: true,
  multipart: true,
});
```

## 공개 API 개요

- `createExpressAdapter(options)`: Express HTTP 어댑터를 위한 팩토리입니다.
- `bootstrapExpressApplication(module, options)`: 수동 제어를 위한 고급 부트스트랩 헬퍼입니다.
- `runExpressApplication(module, options)`: 시그널 연결을 포함한 빠른 시작을 위한 호환 헬퍼입니다.
- `ExpressHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.

## 관련 패키지

- `@konekti/runtime`: 핵심 프레임워크 런타임입니다.
- `@konekti/platform-fastify`: 고성능을 지향하는 대안 어댑터입니다.
- `@konekti/websockets`: Express를 위한 실시간 게이트웨이 지원을 제공합니다.

## 예제 소스

- `packages/platform-express/src/adapter.test.ts`
- `examples/minimal/src/main.ts` (Fastify 기반이지만 공유 `KonektiFactory` 패턴을 보여줌)

