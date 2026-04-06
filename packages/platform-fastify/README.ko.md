# @konekti/platform-fastify

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 애플리케이션을 위한 Fastify 기반 HTTP 어댑터입니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/concepts/http-runtime.ko.md`
- `../../docs/concepts/lifecycle-and-shutdown.ko.md`
- `../../docs/concepts/observability.ko.md`
- `../../docs/reference/package-chooser.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/platform-fastify fastify
```

## 빠른 시작

```typescript
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createFastifyAdapter(options)` - Fastify `HttpApplicationAdapter`를 생성합니다.
- `bootstrapFastifyApplication(rootModule, options)` - 고급 부트스트랩 헬퍼(암시적 종료 시그널 연결 없음)입니다.
- `runFastifyApplication(rootModule, options)` - 부트스트랩 + 수신(listen) + 시작 로그 + 종료 시그널 연결을 위한 호환 헬퍼입니다.

### 지원 옵션

새 애플리케이션 시작 예시는 `KonektiFactory.create(..., { adapter: createFastifyAdapter(...) })`를 우선 사용해야 합니다. `runFastifyApplication()` 및 `bootstrapFastifyApplication()`은 호환 또는 고급 경로로 유지됩니다.

`runFastifyApplication()` 및 `bootstrapFastifyApplication()`은 `@konekti/runtime/node`의 `runNodeApplication()`과 동일한 형태의 런타임 옵션을 지원합니다.

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)
- `shutdownTimeoutMs`

`runFastifyApplication()`은 다음 옵션도 지원합니다.

- `shutdownSignals`
- `forceExitTimeoutMs`

## 패리티(Parity) 참고 사항

- `rawBody`는 선택 사항(opt-in)이며 멀티파트가 아닌 요청에 대해서만 채워집니다.
- 멀티파트 요청은 `request.body` 필드와 `request.files` (`UploadedFile[]`)를 노출합니다.
- 이제 어댑터가 `FrameworkResponse.stream`을 노출하므로 SSE 및 기타 스트리밍 응답은 raw Node response 덕타이핑에 의존하지 않습니다.
- 선택된 플랫폼의 Node 소유 realtime listener 경계가 필요한 통합을 위해 어댑터는 `{ kind: 'server-backed', server }` realtime capability를 노출합니다.
- 그 realtime capability seam을 통해 raw `@konekti/websocket/node` 게이트웨이 호스팅을 지원합니다.
- 시작 로그는 런타임 컨벤션을 따르며 와일드카드 호스트에 대한 바인딩 대상 상세 정보를 포함합니다.
- 시그널 기반 종료는 `@konekti/runtime/node`에 문서화된 Node 호환 종료 경로를 따르며, `forceExitTimeoutMs`로 강제 종료 watchdog을 둘 수 있습니다.
- `forceExitTimeoutMs`가 `shutdownTimeoutMs`보다 짧으면 전체 drain window가 끝나기 전에 watchdog이 의도적으로 프로세스를 종료할 수 있습니다.

## 벤치마크

아래 표는 동일한 `/health` 엔드포인트에서 16개 스레드 / 128개 연결을 사용하여 30초 동안 `wrk`로 측정한 Node 기본 어댑터와 Fastify 어댑터의 비교입니다.

| 어댑터 | 초당 요청 수 (Req/sec) | 평균 지연 시간 (Avg latency) | 참고 |
| --- | ---: | ---: | --- |
| `@konekti/runtime` Node 어댑터 | 31,412 | 4.03ms | 기준 |
| `@konekti/platform-fastify` | 58,927 | 2.14ms | 동시성 환경에서 더 높은 처리량 |

동일한 앱 모듈에서 각 어댑터를 하나씩 실행하고 다음 명령어를 사용하여 재현할 수 있습니다.

```bash
wrk -t16 -c128 -d30s http://127.0.0.1:3000/health
```

이 수치는 방향성 지표로만 참고하세요. 실제 배포 토폴로지와 페이로드 프로필에서 검증하시기 바랍니다.

## 비목표 및 의도된 제한사항

- 이 어댑터는 `@konekti/runtime`를 대체하지 않으며, HTTP 전송 계층만 교체합니다. 부트스트랩/생명주기/DI/종료는 계속 Konekti 런타임이 소유합니다.
- Fastify plugin passthrough는 제공하지 않습니다. 프레임워크 미들웨어와 가드는 Fastify hook이 아니라 Konekti 디스패처를 통해 실행되며, native Fastify plugin은 자동 브리지되지 않습니다.
- `rawBody`는 opt-in이며 multipart 요청에서는 제외됩니다. 이 동작은 Node 어댑터와 동일합니다.
- standalone Fastify 모드는 지원하지 않습니다. 이 어댑터는 Konekti 런타임 부트스트랩 경로가 필요하며 단독 Fastify 서버로 사용할 수 없습니다.
- 이 패키지는 Fastify 전용 WebSocket 게이트웨이 API를 추가하지 않으며, realtime 통합은 노출된 server-backed capability seam을 통해 붙어야 합니다.

#### 0.x 마이그레이션 노트

- Node 호환 헬퍼 import는 `@konekti/runtime` 루트 배럴 대신 `@konekti/runtime/node`를 사용해야 합니다.
- 이전에 SSE를 위해 `FrameworkResponse.raw`까지 직접 내려가던 Fastify 연동 확장은 이제 `FrameworkResponse.stream`으로 이동해야 합니다.
