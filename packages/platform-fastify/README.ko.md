# @konekti/platform-fastify

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 애플리케이션을 위한 Fastify 기반 HTTP 어댑터입니다.

## 설치

```bash
npm install @konekti/platform-fastify fastify
```

## 빠른 시작

```typescript
import { runFastifyApplication } from '@konekti/platform-fastify';

await runFastifyApplication(AppModule, {
  port: 3000,
});
```

## API

- `createFastifyAdapter(options)` - Fastify `HttpApplicationAdapter`를 생성합니다.
- `bootstrapFastifyApplication(rootModule, options)` - 암시적 종료 시그널 연결 없이 부트스트랩합니다.
- `runFastifyApplication(rootModule, options)` - 부트스트랩 + 수신(listen) + 시작 로그 + 종료 시그널 연결을 수행합니다.

### 지원 옵션

`runFastifyApplication()` 및 `bootstrapFastifyApplication()`은 `runNodeApplication()`과 동일한 형태의 런타임 옵션을 지원합니다.

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)

## 패리티(Parity) 참고 사항

- `rawBody`는 선택 사항(opt-in)이며 멀티파트가 아닌 요청에 대해서만 채워집니다.
- 멀티파트 요청은 `request.body` 필드와 `request.files` (`UploadedFile[]`)를 노출합니다.
- 시작 로그는 런타임 컨벤션을 따르며 와일드카드 호스트에 대한 바인딩 대상 상세 정보를 포함합니다.

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
