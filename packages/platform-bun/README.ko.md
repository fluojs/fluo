# @konekti/platform-bun

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@konekti/runtime/web`의 공용 fetch-style 어댑터 seam을 재사용하는 Bun 기반 Konekti HTTP 어댑터입니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/platform-bun
```

## 빠른 시작

```typescript
import { createBunAdapter } from '@konekti/platform-bun';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createBunAdapter(options)` - Bun `HttpApplicationAdapter`를 생성합니다.
- `createBunFetchHandler({ dispatcher, ...options })` - 공용 fetch-style 어댑터 seam 위에 Bun `fetch(request)` 핸들러를 생성합니다.
- `bootstrapBunApplication(rootModule, options)` - 암시적 시작 로그 없이 애플리케이션을 부트스트랩하는 고급 헬퍼입니다.
- `runBunApplication(rootModule, options)` - 부트스트랩 + listen + 시작 로그 + 종료 시그널 연결을 제공하는 호환 헬퍼입니다.

### 지원 옵션

`createBunAdapter()`, `bootstrapBunApplication()`, `runBunApplication()`은 다음 Bun 어댑터 옵션을 지원합니다.

- `port`
- `hostname`
- `tls`
- `idleTimeout`
- `development`
- `maxBodySize`
- `rawBody`
- `multipart`

`runBunApplication()`은 다음 옵션도 지원합니다.

- `shutdownSignals`
- `forceExitTimeoutMs`

## supported operations

- 공유 `@konekti/runtime/web` fetch-style 어댑터 seam을 재사용해 Bun의 native `Request` 처리를 Konekti `FrameworkRequest` / `FrameworkResponse`로 브리지합니다.
- query string, cookie, JSON/text body parsing, multipart parsing, canonical error envelope 등 공용 fetch-style 요청 시맨틱을 유지합니다.
- 공용 seam이 `FrameworkResponse.stream`을 노출하므로 SSE 및 스트리밍 응답은 raw Node writer가 아니라 어댑터 소유 스트림 계약을 따릅니다.
- Bun의 `Bun.serve()` + `server.upgrade()` 요청 업그레이드 호스팅을 위해 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` capability를 노출합니다.
- Bun 네이티브 realtime 통합을 위한 명시적 바인딩 seam을 제공하며, raw websocket은 `@konekti/websockets/bun`, 공식 Socket.IO 경로는 `@konekti/socket.io` + `@socket.io/bun-engine`이 이 seam을 소비합니다.
- `KonektiFactory.create(..., { adapter: createBunAdapter(...) })` 형태의 adapter-first 시작과 `runBunApplication()` 호환 헬퍼를 모두 지원합니다.

## runtime invariants

- `rawBody`는 opt-in이며 multipart 요청에서는 비워 둡니다.
- 디스패처가 응답을 커밋하지 않으면 공용 fetch-style 어댑터 seam이 빈 페이로드로 Bun 응답을 마무리합니다.
- SSE 프레이밍과 스트리밍 응답 동작은 다른 fetch-style 런타임 어댑터가 공유하는 동일한 seam을 재사용합니다.
- `globalThis.Bun.serve()`가 없으면 어댑터가 명시적인 오류와 함께 즉시 실패합니다.

## lifecycle guarantees

- `listen(dispatcher)`는 어댑터 생명주기 동안 정확히 하나의 Bun server 인스턴스를 생성합니다.
- `close(signal?)`는 활성 Bun server를 중지하고 어댑터가 보유한 server handle을 해제합니다.
- `runBunApplication()`은 런타임 시작 로그 형식을 따르며, Node 호환 process signal을 노출하는 Bun 환경에서는 종료 시그널 정리까지 연결할 수 있습니다.

## intentional limitations

- 이 어댑터는 `@konekti/runtime`를 대체하지 않으며, 부트스트랩/DI/미들웨어/가드/종료 소유권은 런타임 패키지에 남습니다.
- Bun의 native `fetch` + `Bun.serve()` 계약을 넘는 standalone app builder는 제공하지 않으며, 프레임워크 통합은 계속 Konekti 런타임 facade를 통해 흐릅니다.
- Node 전용 writable response escape hatch는 제공하지 않으며, 스트리밍 응답은 `FrameworkResponse.stream`을 사용해야 합니다.
- Deno, Cloudflare Workers 같은 다른 fetch-style 런타임은 별도 어댑터 범위로 유지됩니다.
- Bun용 raw websocket 호스팅은 전용 `@konekti/websockets/bun` 바인딩을 통해 제공되며, Bun 전용 Socket.IO 호스팅은 이제 `@konekti/socket.io`와 공식 `@socket.io/bun-engine` 경로를 통해 제공됩니다. `@konekti/websockets/node`는 계속 Node upgrade-listener 전용 경계로 유지되며 Bun 지원을 주장하지 않습니다.
