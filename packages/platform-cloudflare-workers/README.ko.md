# @konekti/platform-cloudflare-workers

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

공유 `@konekti/runtime/web` request/response 브리지를 기반으로 한 Cloudflare Workers용 Konekti HTTP 어댑터입니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/platform-cloudflare-workers
```

## 빠른 시작

### 표준 adapter-first 부트스트랩

```typescript
import { KonektiFactory } from '@konekti/runtime';
import { createCloudflareWorkerAdapter } from '@konekti/platform-cloudflare-workers';

const adapter = createCloudflareWorkerAdapter({ rawBody: true });
const app = await KonektiFactory.create(AppModule, {
  adapter,
});

await app.listen();

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return adapter.fetch(request, env, ctx);
  },
};
```

### Lazy Worker 엔트리포인트

```typescript
import { createCloudflareWorkerEntrypoint } from '@konekti/platform-cloudflare-workers';

const worker = createCloudflareWorkerEntrypoint(AppModule, {
  rawBody: true,
});

export default {
  fetch: worker.fetch,
};
```

## API

- `createCloudflareWorkerAdapter(options)` - 어댑터 소유 `fetch()` 엔트리포인트를 가진 Cloudflare Workers `HttpApplicationAdapter`를 생성합니다.
- `bootstrapCloudflareWorkerApplication(rootModule, options)` - 즉시 요청을 받을 수 있는 Worker 애플리케이션을 부트스트랩하고 `{ app, adapter, fetch, close }`를 반환합니다.
- `createCloudflareWorkerEntrypoint(rootModule, options)` - 첫 요청 시 애플리케이션을 지연 부트스트랩하고, 같은 Worker isolate 안에서는 동일 런타임 인스턴스를 재사용합니다.

### 지원 옵션

Worker 부트스트랩 헬퍼는 `@konekti/runtime/internal`의 공유 HTTP 어댑터 미들웨어/런타임 옵션과 공유 Web 브리지 옵션을 함께 지원합니다.

- `cors` (`false | string | string[] | CorsOptions`)
- `globalPrefix`
- `globalPrefixExclude`
- `middleware`
- `securityHeaders`
- `rawBody`
- `multipart`
- `maxBodySize`

## supported operations

- Request/Response 변환 로직을 복제하지 않고 `@konekti/runtime/web`의 `dispatchWebRequest(...)`를 재사용합니다.
- native Worker `Request`를 Konekti `FrameworkRequest` / `FrameworkResponse` 계약으로 브리지합니다.
- 멀티파트가 아닌 요청에 대해 `rawBody` opt-in 동작을 유지합니다.
- 공유 Web 코어를 통해 multipart 파싱과 `request.files` 노출을 지원합니다.
- 공유 Web `FrameworkResponse.stream` 구현을 통해 SSE 및 기타 스트리밍 응답을 지원합니다.
- Worker 부트스트랩 헬퍼에서 공유 런타임 HTTP 미들웨어(`cors`, `globalPrefix`, `securityHeaders`)를 적용합니다.

## runtime invariants

- 응답 직렬화, 에러 엔벨로프, malformed cookie 처리, multipart 파싱, SSE 프레이밍은 공유 `@konekti/runtime/web` 계약을 따릅니다.
- `fetch()`는 소켓을 열거나 프로세스 리스너를 소유하지 않으며, 이미 부트스트랩된 런타임 디스패처로 Worker 요청을 전달만 합니다.
- Worker 설정에서의 `app.listen()`은 디스패처를 어댑터에 바인딩하고 애플리케이션을 ready 상태로 만들지만, 네트워크 리스너를 생성하지는 않습니다.
- `close()`는 수동으로 호출했을 때(주로 테스트나 커스텀 isolate teardown) 디스패처 바인딩을 해제하고 일반 런타임 종료 훅을 실행합니다.

## lifecycle guarantees

- `createCloudflareWorkerAdapter().listen(dispatcher)`는 deterministic하며 현재 디스패처 바인딩을 idempotent하게 교체합니다.
- `createCloudflareWorkerEntrypoint()`는 Worker isolate 단위로 부트스트랩된 애플리케이션을 캐시하고 `close()` 전까지 요청 간 재사용합니다.
- `bootstrapCloudflareWorkerApplication()`은 이미 listen까지 끝난 Worker 애플리케이션을 반환하므로, 내보낸 `fetch()` 핸들러가 즉시 요청을 처리할 수 있습니다.

## intentional limitations

- 이 패키지는 Node의 listener lifecycle, startup log, shutdown signal wiring을 흉내 내지 않습니다. Cloudflare Workers에는 대응되는 프로세스 소유 `listen()`/`SIGTERM` 계약이 없습니다.
- Worker `env`와 `ExecutionContext`는 `fetch()` 경계에서 받지만, Konekti `RequestContext`로 자동 주입되지는 않습니다.
- `port`, `host`, `https`, `shutdownSignals`, `forceExitTimeoutMs` 같은 Node 전용 옵션은 지원하지 않습니다.
- 이 패키지는 Bun/Deno 전용 동작을 추가하지 않으며, 공유 Web 코어 위의 Cloudflare Workers 범위에만 집중합니다.
