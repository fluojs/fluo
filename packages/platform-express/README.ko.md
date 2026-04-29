# @fluojs/platform-express

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 Express 기반 HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [어댑터 계약](#어댑터-계약)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-express express
```

## 사용 시점

fluo 애플리케이션의 기본 HTTP 엔진으로 Express를 사용하려는 경우에 이 패키지를 사용합니다. 이는 fluo의 데코레이터 기반 아키텍처 내에서 Express의 강력한 생태계, 성숙한 Node.js 서버 처리 및 친숙한 요청/응답 생명주기를 활용하는 데 유용합니다.

## 빠른 시작

```typescript
import { createExpressAdapter } from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 스트리밍 응답 처리 (SSE)
Express 어댑터는 공유 `SseResponse` 유틸리티를 통해 Server-Sent Events(SSE)를 지원하며, Express 전용 스트림 처리를 추상화합니다.

Express 기반 응답 스트림은 공유 fluo 백프레셔 계약도 따릅니다. `response.stream.waitForDrain()`은 `drain`, `close`, `error` 중 어느 쪽이 먼저 와도 완료되므로, 백프레셔가 풀리기 전에 클라이언트가 연결을 끊어도 스트리밍 작성기가 멈추지 않습니다.

```typescript
@Get('events')
async streamEvents(@Res() res: FrameworkResponse) {
  const events = new SseResponse();
  events.send({ data: 'hello' });
  return events;
}
```

### 바디 파싱 및 멀티파트
`rawBody` 및 멀티파트 form-data 파싱을 즉시 사용할 수 있습니다. 어댑터를 직접 생성할 때는 멀티파트 제한을 두 번째 인자로 전달하고, `bootstrapExpressApplication(...)` 및 `runExpressApplication(...)`에서는 같은 설정을 `options.multipart` 아래에 전달하면 됩니다. `multipart.maxTotalSize`를 지정하지 않으면 `maxBodySize`가 기본 총 멀티파트 payload 제한으로 사용되어 HTTP 어댑터 간 바디 크기 제한 동작이 portable하게 유지됩니다.

```typescript
const adapter = createExpressAdapter(
  {
    port: 3000,
    rawBody: true,
  },
  {
    maxTotalSize: 10 * 1024 * 1024,
  },
);
```

### 안전한 fallback을 포함한 Native Route Registration
이제 어댑터는 의미 보존이 가능한 명시적 HTTP 메서드 라우트를 Express Router에 사전 등록하면서도, 실제 요청 처리는 계속 공유 fluo dispatcher를 통해 수행합니다.

덕분에 guards, interceptors, observers, body parsing, raw body 캡처, SSE, 오류 응답은 기존과 같은 framework-owned 실행 경로를 유지하면서, Express가 먼저 일부 경로 매칭 비용을 줄일 수 있습니다.

문서화된 fluo semantics를 바꾸지 않기 위해 `/:id` 와 `/:slug`처럼 shape가 겹치는 파라미터 라우트, `@All(...)` 핸들러, `OPTIONS` 소유권, 그리고 duplicate slash/trailing slash 정규화에 의존하는 요청은 catch-all fallback 경로에 남겨둡니다.

## 어댑터 계약

- **공유 dispatcher 소유권 유지**: Native Express Router 매치 이후에도 실제 요청은 공유 fluo dispatcher가 처리하므로 middleware, guards, interceptors, observers, params, error envelope 계약은 그대로 유지됩니다.
- **안전한 fallback 범위**: `@All(...)` 핸들러와 shape가 겹치는 파라미터 라우트는 Express Router에 강제 등록하지 않고 의도적으로 catch-all fallback 경로에 둡니다.
- **OPTIONS 소유권 parity**: 어댑터는 native route에 대해 Express Router가 `OPTIONS`를 자동 응답하지 못하게 막아, 미지원 메서드도 계속 fluo dispatcher semantics로 흘러가고 `@All(...)` 핸들러가 정의된 경우 `OPTIONS`도 그대로 소유할 수 있게 합니다.
- **경로 정규화 parity**: duplicate slash 변형처럼 Express Router와 fluo의 정규화 방식이 다를 수 있는 요청도 fallback dispatch를 통해 fluo의 normalized route contract를 유지합니다.
- **버저닝 parity**: Express Router가 최초 path match를 하더라도 header/media-type/custom version 선택은 계속 dispatcher가 최종 결정합니다.

## 공개 API 개요

- `createExpressAdapter(options)`: Express HTTP 어댑터를 위한 팩토리입니다.
- `bootstrapExpressApplication(module, options)`: 수동 제어를 위한 고급 부트스트랩 헬퍼입니다.
- `runExpressApplication(module, options)`: 시그널 연결을 포함한 빠른 시작을 위한 호환 헬퍼입니다. timeout/실패 시에는 해당 상태를 로그와 `process.exitCode`로 보고하고, 최종 프로세스 종료는 주변 호스트에 맡깁니다.
- `ExpressHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 프레임워크 런타임입니다.
- `@fluojs/platform-fastify`: 고성능을 지향하는 대안 어댑터입니다.
- `@fluojs/websockets`: Express를 위한 실시간 게이트웨이 지원을 제공합니다.

## 예제 소스

- `packages/platform-express/src/adapter.test.ts`
- `examples/minimal/src/main.ts` (Fastify 기반이지만 공유 `fluoFactory` 패턴을 보여줌)
