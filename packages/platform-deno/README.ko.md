# @konekti/platform-deno

<p><strong><kbd>English</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

공유 `@konekti/runtime/web` fetch-style 어댑터 seam 위에 구축된 Konekti 런타임용 Deno 기반 HTTP 어댑터입니다.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
deno add npm:@konekti/platform-deno npm:@konekti/runtime npm:@konekti/http
```

## Quick Start

```typescript
import { Controller, Get } from '@konekti/http';
import { runDenoApplication } from '@konekti/platform-deno';

@Controller('/health')
class HealthController {
  @Get('/')
  check() {
    return { status: 'ok' };
  }
}

class AppModule {}

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## API

- `createDenoAdapter(options)` - Deno `HttpApplicationAdapter`를 생성합니다
- `bootstrapDenoApplication(rootModule, options)` - 암묵적인 OS signal wiring 없이 bootstrap만 수행하는 고급 헬퍼입니다
- `runDenoApplication(rootModule, options)` - bootstrap + listen + 시작 로그를 묶는 호환 헬퍼입니다
- `DenoHttpApplicationAdapter.handle(request)` - native Web `Request`를 직접 dispatch하고 native Web `Response`를 반환합니다

### Supported options

`createDenoAdapter()`, `bootstrapDenoApplication()`, `runDenoApplication()`은 다음 옵션을 지원합니다.

- `port`
- `hostname`
- `rawBody`
- `multipart`
- `maxBodySize`
- bootstrap 헬퍼를 통한 `cors` (`false | string | string[] | CorsOptions`)
- bootstrap 헬퍼를 통한 `globalPrefix` / `globalPrefixExclude`
- bootstrap 헬퍼를 통한 `securityHeaders`
- 테스트나 커스텀 호스팅 셸에서 명시적으로 `Deno.serve`를 주입하기 위한 `serve`
- Deno의 바인드 주소 콜백을 관찰하기 위한 `onListen`

## supported operations

- native Web `Request` / `Response` 처리를 공유 `@konekti/runtime/web` fetch-style 어댑터 seam으로 브리지하여, Deno가 다른 fetch-style 어댑터와 동일한 요청 파싱, raw-body, multipart, error-envelope, SSE 동작을 공유합니다.
- 테스트와 커스텀 `Deno.serve(...)` 조합을 위해 `handle(request)`를 제공합니다.
- non-multipart 요청에 대해 `rawBody` opt-in을 지원합니다.
- multipart form-data 파싱을 지원하고 업로드 파일을 `UploadedFile[]`로 노출합니다.
- Deno의 `Deno.upgradeWebSocket(request)` 요청 업그레이드 호스팅을 위해 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` capability를 노출합니다.
- `runDenoApplication()`을 통해 런타임 스타일 listen 로그를 출력합니다.

## runtime invariants

- multipart 요청에서는 `rawBody`가 절대 채워지지 않습니다.
- SSE 및 기타 스트리밍 응답은 Node 전용 response 객체가 아니라 native Web `Response` 스트리밍을 통해 전송됩니다.
- dispatcher가 아직 바인딩되지 않았다면 요청은 멈추지 않고 canonical framework error envelope로 직렬화됩니다.
- 어댑터는 Deno 전용 파싱 로직을 복제하지 않고 공유 fetch-style 어댑터 seam 안에서 request/response 변환을 유지합니다.

## lifecycle guarantees

- `listen()`은 `Deno.serve(...)`를 시작하고 요청 처리 전에 Konekti dispatcher를 바인딩합니다.
- `close()`는 활성 serve signal을 abort하고, 하위 서버의 `shutdown()`을 호출한 뒤, `finished`를 기다리고 나서 resolve합니다.
- `runDenoApplication()`은 시작 로그를 추가하지만 암묵적인 OS signal handler는 설치하지 않습니다.

## intentional limitations

- 이 패키지는 `@konekti/runtime`를 대체하지 않습니다. 모듈 그래프 컴파일, DI, lifecycle hook, 애플리케이션 orchestration은 계속 runtime 패키지가 담당합니다.
- Bun, Cloudflare, Deno Deploy 전용 bootstrap helper는 여기서 제공하지 않습니다.
- 아직 Deno native HTTPS/TLS passthrough는 노출하지 않습니다. public contract가 정의되면 별도 이슈로 추가하세요.
- 이 어댑터는 native Web `Request` / `Response` 의미론을 대상으로 하며 Node compatibility layer는 제공하지 않습니다.
- Deno용 raw websocket 호스팅은 전용 `@konekti/websocket/deno` 바인딩을 통해 제공됩니다. `@konekti/websocket/node`는 계속 Node upgrade-listener 전용 경계로 유지되며 Deno 지원을 주장하지 않습니다.
