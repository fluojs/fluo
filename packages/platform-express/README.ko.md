# @konekti/platform-express

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 애플리케이션을 위한 Express 기반 HTTP 어댑터입니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/concepts/observability.ko.md`
- `../../docs/reference/package-chooser.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/platform-express express
```

## 빠른 시작

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createExpressAdapter(options)` - Express `HttpApplicationAdapter`를 생성합니다.
- `bootstrapExpressApplication(rootModule, options)` - 고급 부트스트랩 헬퍼(암시적 종료 시그널 연결 없음)입니다.
- `runExpressApplication(rootModule, options)` - 부트스트랩 + 수신(listen) + 시작 로그 + 종료 시그널 연결을 위한 호환 헬퍼입니다.

### 지원 옵션

새 애플리케이션 시작 예시는 `KonektiFactory.create(..., { adapter: createExpressAdapter(...) })`를 우선 사용해야 합니다. `runExpressApplication()` 및 `bootstrapExpressApplication()`은 호환 또는 고급 경로로 유지됩니다.

`runExpressApplication()` 및 `bootstrapExpressApplication()`은 `@konekti/runtime/node`의 `runNodeApplication()`과 동일한 형태의 런타임 옵션을 지원합니다.

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)
- `shutdownTimeoutMs`

`runExpressApplication()`은 다음 옵션도 지원합니다.

- `shutdownSignals`
- `forceExitTimeoutMs`

## supported operations

- Express 요청/응답을 `FrameworkRequest` / `FrameworkResponse`로 브리지합니다.
- SSE 및 기타 어댑터 소유 응답 스트리밍 경로를 위해 `FrameworkResponse.stream`을 노출합니다.
- Node가 소유하는 realtime listener 경계가 필요한 통합을 위해 `{ kind: 'server-backed', server }` realtime capability를 노출합니다.
- 그 realtime capability seam을 통해 raw `@konekti/websocket/node` 게이트웨이 호스팅을 지원합니다.
- 모든 인바운드 요청을 Konekti HTTP 디스패처로 전달합니다.
- 멀티파트가 아닌 요청에서 `rawBody` 선택(opt-in) 보존을 지원합니다.
- multipart form-data 파싱과 `UploadedFile[]` 노출을 지원합니다.
- 시작 재시도(`EADDRINUSE`)와 HTTPS 리스너 옵션을 지원합니다.

## runtime invariants

- multipart 요청에서는 `rawBody`를 채우지 않습니다.
- 디스패처가 응답을 커밋하지 않으면 어댑터가 빈 페이로드를 전송해 응답을 종료합니다.
- 이제 SSE 및 기타 스트리밍 응답은 `FrameworkResponse.raw`에 의존하지 않으며, 어댑터가 `FrameworkResponse.stream` 뒤에서 구체 writable semantics를 소유합니다.
- 시작 로그는 런타임 컨벤션(`Listening on ...`)을 따르며 와일드카드 호스트 바인딩 상세를 포함합니다.
- 문자열/JSON/바이너리 페이로드 직렬화 동작은 runtime/fastify 어댑터 기대치와 일치합니다.

## lifecycle guarantees

- `close(signal?)`는 graceful shutdown을 수행하고 `shutdownTimeoutMs`를 강제합니다.
- `runExpressApplication()`에서 기본 `SIGINT` / `SIGTERM` 기반 종료를 지원합니다.
- `forceExitTimeoutMs`를 설정하면 종료 미완료 시 프로세스를 강제 종료할 수 있습니다.

## intentional limitations

- 이 어댑터는 `@konekti/runtime`를 대체하지 않으며, 부트스트랩/생명주기/DI/종료 소유권은 런타임 패키지에 유지됩니다.
- Express plugin/middleware passthrough 계층은 제공하지 않으며, 미들웨어/가드/인터셉터는 Konekti 디스패처 계약을 통해 동작합니다.
- standalone Express 모드는 제공하지 않습니다. 이 어댑터는 런타임 소유 시작 경로를 전제로 합니다.
- 이 패키지가 자체 WebSocket 게이트웨이 API나 별도 트랜스포트 표면을 제공하지는 않으며, realtime 통합은 노출된 server-backed capability seam을 통해 붙어야 합니다.

#### 0.x 마이그레이션 노트

- Node 호환 헬퍼 import는 `@konekti/runtime` 루트 배럴 대신 `@konekti/runtime/node`를 사용해야 합니다.
