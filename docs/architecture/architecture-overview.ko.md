# Package Architecture Reference

<p><a href="./architecture-overview.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Layer Model

| Layer | Representative packages | Responsibility | Boundary |
| --- | --- | --- | --- |
| Core | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` | 데코레이터, 의존성 해석, 구성 접근, 부트스트랩 순서, 런타임 오케스트레이션을 정의한다. | Core 패키지는 구체적인 HTTP 서버나 기능 통합과 분리된 프레임워크 계약을 제공해야 한다. |
| Transport | `@fluojs/http`, `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` | 요청 실행, 라우팅, 응답 기록, 호스팅 환경 어댑터를 런타임 계약에 연결한다. | Transport 패키지는 런타임용 어댑터 접점을 구현해야 하며, core 계층의 DI 또는 구성 규칙을 다시 정의하면 안 된다. |
| Feature | `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi`, `@fluojs/jwt`, `@fluojs/passport`, `@fluojs/cqrs`, `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/websockets`, `@fluojs/socket.io` | 코어와 전송 계약 위에 프로토콜 확장, 영속성 통합, 인증, 관측성, 애플리케이션 기능을 추가한다. | Feature 패키지는 문서화된 프레임워크 접점에 붙어야 하며, 별도의 부트스트랩, DI, 플랫폼 수명주기를 도입하면 안 된다. |

## Package Responsibilities

| Package or family | Layer | Responsibility | Factual reference |
| --- | --- | --- | --- |
| `@fluojs/core` | Core | TC39 표준 데코레이터와 프레임워크 메타데이터 헬퍼를 소유한다. | `docs/architecture/decorators-and-metadata.ko.md` |
| `@fluojs/di` | Core | provider, scope, visibility, module graph 주입을 해석한다. | `docs/architecture/di-and-modules.ko.md` |
| `@fluojs/config` | Core | 검증된 구성 스냅샷을 로드하고 환경 접근을 중앙화한다. | `docs/architecture/config-and-environments.ko.md` |
| `@fluojs/runtime` | Core | 모듈을 컴파일하고, 런타임 토큰을 등록하고, lifecycle hook을 조정하고, adapter shell을 시작한다. | `docs/getting-started/bootstrap-paths.ko.md` |
| `@fluojs/http` | Transport | request context, routing phase, guard, interceptor, materialization, response serialization을 정의한다. | `docs/architecture/http-runtime.ko.md` |
| `@fluojs/platform-*` | Transport | Node.js, Bun, Deno, Express, Fastify, Cloudflare Workers용 구체 런타임 어댑터를 구현한다. | `docs/architecture/platform-consistency-design.ko.md` |
| `@fluojs/graphql` | Feature | HTTP 실행 모델을 GraphQL schema 노출과 resolver 실행으로 확장한다. | `docs/reference/package-surface.ko.md` |
| `@fluojs/validation` and `@fluojs/serialization` | Feature | 입력 materialization, validation 경계, 출력 shaping을 강제한다. | `docs/reference/package-surface.ko.md` |
| `@fluojs/openapi` | Feature | HTTP 메타데이터를 OpenAPI 표면 문서로 투영한다. | `docs/reference/package-surface.ko.md` |
| `@fluojs/jwt` and `@fluojs/passport` | Feature | 코어 요청 파이프라인을 바꾸지 않고 인증, principal 처리, strategy 통합을 추가한다. | `docs/reference/package-surface.ko.md` |
| Persistence packages | Feature | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis` 같은 패키지별 어댑터를 통해 저장소와 캐시 통합을 담당한다. | `docs/reference/package-surface.ko.md` |
| Operational packages | Feature | `@fluojs/terminus`, `@fluojs/metrics`를 통해 상태 점검, 메트릭, 런타임 관측성을 추가한다. | `docs/reference/package-surface.ko.md` |
| Realtime packages | Feature | `@fluojs/websockets`, `@fluojs/socket.io`를 통해 gateway와 양방향 전송 지원을 추가한다. | `docs/reference/package-surface.ko.md` |

## Dependency Rules

| Rule | Statement |
| --- | --- |
| Rule 1 | Core 패키지는 transport adapter나 feature 패키지에 의존하면 안 된다. |
| Rule 2 | Transport 패키지는 core 계약에는 의존할 수 있지만, core 계층이 소유한 decorator, DI, config primitive를 다시 정의하면 안 된다. |
| Rule 3 | Feature 패키지는 core 패키지와 자신이 확장하는 문서화된 transport 표면에 의존할 수 있다. |
| Rule 4 | Feature 패키지는 `@fluojs/config`, runtime lifecycle contract, 문서화된 adapter seam을 우회하기 위해 hosting environment API에 직접 접근하면 안 된다. |
| Rule 5 | Platform 패키지는 저장소 정책상 `PlatformAdapter`라고 부르는 접점(HTTP transport에서는 `HttpApplicationAdapter`)을 구현해야 하며, HTTP runtime이 정의한 요청 phase 순서를 보존해야 한다. |
| Rule 6 | 패키지 간 통합은 암시적 reflection이나 ambient global이 아니라 export된 module contract, provider token, 문서화된 metadata를 통해 흘러야 한다. |

## Constraints

- Constraint: 이 저장소의 아키텍처 문서는 `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime`을 정식 core 경계로 취급한다.
- Constraint: 패키지는 TC39 표준 데코레이터를 사용해야 하며, `experimentalDecorators` 또는 `emitDecoratorMetadata`를 요구하면 안 된다.
- Constraint: 패키지는 `process.env`를 직접 읽으면 안 되며, 구성은 `@fluojs/config`와 DI를 통해 패키지 코드로 들어와야 한다.
- Constraint: module visibility는 기본적으로 private이며, 모듈 간 접근은 명시적인 `exports` 와 `imports` 체인을 통해서만 이뤄져야 한다.
- Constraint: transport adapter는 runtime contract를 구체 서버로 번역해야 하며, bootstrap 순서, guard 순서, validation 순서, response serialization 순서를 바꾸면 안 된다.
- Constraint: feature integration은 기존 framework seam을 확장해야 하며, 별도의 lifecycle state machine이나 병렬 dependency container를 만들면 안 된다.
