# 최소 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Node.js + Fastify의 canonical `FluoFactory.create(...)` → `app.listen()` 조립을 보여주는 저장소 예제입니다. Factory의 middleware 기본값과 실패 정리를 사용하지만 이 예제의 signal은 host가 소유합니다. 생성 스타터는 같은 생성 경로에서 Node logger와 signal callback을 명시적으로 추가합니다. [Bootstrap recipe](../../docs/getting-started/bootstrap-paths.ko.md)를 참고하세요.

## 이 예제가 보여주는 것

- `FluoFactory.create(..., { adapter: FastifyHttpApplicationAdapter.create(...) })` 기반 명시적 Fastify 부트스트랩
- `@Module`, `@Inject`, `@Controller`, `@Get`을 사용한 표준 데코레이터 DI
- `HealthModule.forRoot(...)`의 내장 `/health` 및 `/ready` 엔드포인트
- `/hello` 경로의 단일 스타터 컨트롤러
- `@FromFiles('attachments')`를 사용한 `/uploads`의 portable multipart DTO 바인딩
- `@fluojs/testing`을 사용한 단위 및 e2e 스타일 테스트

## 실행 방법

이 예제는 fluo 모노레포 내부에 있으며 워크스페이스 링크 패키지를 사용합니다. 저장소 루트에서:

```sh
pnpm install
```

패키지에는 dev/start script가 없습니다. `src/main.ts`를 빌드해 실행하면 네트워크 listener를 시작하지만 아래 저장소 테스트 명령은 그 진입점을 실행하지 않고 요청 파이프라인을 검증합니다.

```sh
pnpm vitest run examples/minimal
```

Node.js `>=24.0.0 <27`과 저장소의 표준 decorator 테스트 설정을 사용합니다. Decorated declaration 평가 전 metadata 준비를 보존하며 예제를 실행하기 위해 legacy decorator flag를 켜지 않습니다. 진입점은 숫자 port `3000`을 직접 전달하며 `PORT` parser나 자동 Node signal 등록이 없습니다.

## 프로젝트 구조

```
examples/minimal/
├── src/
│   ├── app.ts              # AppModule — 루트 모듈
│   ├── main.ts             # 진입점: adapter-first Fastify startup
│   ├── hello.controller.ts # GET /hello
│   ├── hello.service.ts    # 비즈니스 로직
│   ├── upload.controller.ts # POST /uploads portable multipart DTO
│   └── app.test.ts         # unit + createTestApp request helper 테스트
└── README.md
```

## 스타터 스캐폴드와의 관계

이 예제는 `workspace:*` 의존성을 사용하는 `repository-example`이며 registry 기반 `generated-app`이 아닙니다. 생성된 `src/app.ts`는 `ConfigModule`, `GreetingModule`, `HealthModule.forRoot()`를 유지하므로 greeting을 기대하는 테스트를 남겨 둔 채 이 예제의 루트 모듈로 덮어쓰지 않습니다. 생성 lifecycle script는 이 예제의 script가 아니라 `fluo dev`, `fluo build`, `fluo start`를 사용합니다.

이 예제는 기본/명시적 HTTP v2 스타터와 같은 HTTP 생성 경로를 사용하지만, 전체 `fluo new` 출력보다 의도적으로 작습니다. 현재 CLI starter는 controller/service/repository 파일이 들어 있는 `src/greeting/` feature slice, unit test, slice test, `src/app.test.ts`, `test/app.e2e.test.ts`, build/test tooling config를 생성합니다. 그 전체 스타터 경험이 필요하면 기본 명령 또는 명시적 Node.js + Fastify HTTP 계약을 사용하세요.

```sh
pnpm add -g @fluojs/cli
fluo new my-app
fluo new my-app --shape application --transport http --runtime node --platform fastify
```

이 예제는 Express/raw Node.js/Bun/Deno/Cloudflare Workers application starter, TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC microservice starter, mixed single-package starter까지 다루지는 않습니다. 해당 계약은 `../../packages/cli/README.ko.md`, `../../docs/reference/fluo-new-support-matrix.ko.md`, `../../docs/reference/toolchain-contract-matrix.ko.md`를 기준으로 확인하세요.

## 관련 문서

- `../README.ko.md` — 공식 examples 인덱스
- `../../docs/getting-started/quick-start.ko.md` — 표준 시작 가이드
- `../../docs/getting-started/first-feature-path.ko.md` — 스타터 앱에서 첫 기능까지 가는 경로
- `../../docs/reference/fluo-new-support-matrix.ko.md` — 정확한 `fluo new` starter matrix
- `../../docs/reference/package-chooser.ko.md` — 작업별 패키지 선택
- `../../docs/contracts/testing-guide.ko.md` — 테스트 패턴 및 레시피
