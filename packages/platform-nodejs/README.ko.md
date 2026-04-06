# @konekti/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 애플리케이션을 위한 raw Node.js HTTP 어댑터 패키지입니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/reference/package-chooser.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/platform-nodejs
```

## 빠른 시작

```typescript
import { createNodejsAdapter } from '@konekti/platform-nodejs';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createNodejsAdapter(options)` - raw Node.js `HttpApplicationAdapter`를 생성합니다.
- `bootstrapNodejsApplication(rootModule, options)` - 암묵적 listen 없이 부트스트랩만 수행하는 호환 헬퍼입니다.
- `runNodejsApplication(rootModule, options)` - bootstrap + listen + startup logging + shutdown signal wiring을 제공하는 호환 헬퍼입니다.

### 지원 옵션

`createNodejsAdapter()`, `bootstrapNodejsApplication()`, `runNodejsApplication()`은 현재 raw Node 옵션 형태를 그대로 유지합니다.

- `port`
- `host`
- `https`
- `maxBodySize`
- `rawBody`
- `retryDelayMs`
- `retryLimit`
- `shutdownTimeoutMs`

`bootstrapNodejsApplication()`과 `runNodejsApplication()`은 여기에 더해 `@konekti/runtime`에 문서화된 `cors`, `globalPrefix`, `filters`, `converters`, `middleware`, `versioning` 같은 런타임 소유 HTTP 옵션도 계속 지원합니다.

## supported operations

- adapter-first 런타임 facade(`KonektiFactory.create(..., { adapter: createNodejsAdapter(...) })`)를 통해 raw Node.js HTTP 리스너를 명시적으로 선택합니다.
- raw Node 어댑터 entrypoint를 이 패키지가 직접 소유하고, 명시적인 `@konekti/runtime/internal-node` seam을 조합하여 현재 Node request/response 브리지, startup logging, graceful shutdown, HTTPS, retry 시맨틱을 그대로 유지합니다.
- 헬퍼 wrapper 경로가 필요한 사용자를 위해 호환 부트스트랩 헬퍼도 계속 제공합니다.

## runtime invariants

- `rawBody`는 계속 opt-in이며 multipart 요청에서는 채워지지 않습니다.
- startup log와 bind-target 보고 형식은 현재 raw Node 리스너 동작과 동일하게 유지됩니다.
- 어댑터는 기존 `@konekti/runtime/node` 구현과 동일한 graceful shutdown drain window 및 HTTPS 바인딩 동작을 유지합니다.

## lifecycle guarantees

- `listen(dispatcher)`는 어댑터 생명주기 동안 정확히 하나의 Node HTTP/HTTPS 서버를 시작합니다.
- `close(signal?)`는 새 연결 수락을 중단하고, `shutdownTimeoutMs` 동안 기존 요청을 드레인한 뒤 남은 소켓을 정리합니다.
- `runNodejsApplication()`은 애플리케이션 생명주기 전후로 shutdown signal listener를 계속 등록/해제합니다.

## intentional limitations

- 이 패키지는 raw Node 어댑터 경계를 직접 소유하지만, 공유되는 Node 전용 transport 내부 구현은 명시적인 `@konekti/runtime/internal-node` seam에 의존합니다.
- 여기서는 새로운 adapterless startup 시맨틱을 도입하지 않습니다. 어댑터를 생략한 경우 HTTP 서빙을 기대하지 말고, DI/생명주기 전용 부트스트랩에는 `createApplicationContext()`를 사용하세요.
- compression helper나 shutdown registration utility 같은 고급 Node 전용 내부 API는 호환 export로서 계속 `@konekti/runtime/node`에서도 사용할 수 있습니다.
