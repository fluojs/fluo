# konekti

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti는 **표준 데코레이터 문법**을 기반으로 하며, 명시적인 DI(의존성 주입), 예측 가능한 HTTP 런타임, 패키지 단위의 통합, 그리고 CLI 중심의 부트스트랩 흐름을 중심으로 구축된 TypeScript 백엔드 프레임워크입니다.

## 왜 표준 데코레이터를 사용하나요?

- 레거시 데코레이터(`"experimentalDecorators": true`, `"emitDecoratorMetadata": true`)는 TC39 표준화 이전에 만들어진 TypeScript 전용 동작이며, NestJS는 현재 이 모델에 의존합니다.
- 표준 데코레이터(TC39 Stage 3, TypeScript 5.0+ 지원)는 JavaScript 표준 방향이며 위 레거시 플래그가 필요하지 않습니다.
- NestJS는 TC39 데코레이터를 지원하지 않겠다고 공개적으로 밝혔습니다: https://github.com/nestjs/nest/issues/10676.
- 따라서 NestJS 앱은 장기적으로 JavaScript 표준과 다른 데코레이터 모델을 유지하게 되고, Konekti 앱은 표준 모델에 그대로 맞춰집니다.
- Konekti 앱은 표준 TypeScript 설정(`"experimentalDecorators": false` 또는 플래그 생략)과 `emitDecoratorMetadata` 없이 동작합니다.

## Konekti의 구체적인 차별점

- **`emitDecoratorMetadata` 비의존**: Konekti DI는 TypeScript 런타임 메타데이터 방출에 의존하지 않습니다.
- **리플렉션 기반 DI 자동 주입 없음**: 런타임 타입 메타데이터 추론 대신 토큰을 명시적으로 선언합니다(예: `@Inject([USER_REPOSITORY, LOGGER])`).
- **레거시 데코레이터 플래그 불필요**: Konekti는 TC39 표준 데코레이터를 사용하며 `"experimentalDecorators": true`가 필요하지 않습니다.
- **패키지 단위 통합 경계**: `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle` 같은 통합은 숨겨진 플랫폼 결합이 아니라 명시적인 패키지 API입니다.

Konekti 앱의 최소 tsconfig 기준:

```json
{
  "compilerOptions": {
    "experimentalDecorators": false
  }
}
```

## 빠른 시작 (Quick Start)

표준 공개 부트스트랩 경로를 사용하여 시작 앱을 생성하세요.

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

생성된 앱에는 다음이 포함됩니다:

- 런타임 소유의 `src/main.ts` 부트스트랩
- `/health`, `/ready`, 그리고 `/health-info/`를 제공하는 최소 `health/` 모듈 예시
- 바로 사용할 수 있는 `dev`, `build`, `typecheck`, `test` 명령어

## Konekti 포함 패키지

### 핵심 프레임워크 패키지

- `@konekti/core`
- `@konekti/config`
- `@konekti/di`
- `@konekti/http`
- `@konekti/runtime`
- `@konekti/testing`

### 검증, 인증 및 문서화 패키지

- `@konekti/dto-validator`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/event-bus`
- `@konekti/microservices`
- `@konekti/websocket`
- `@konekti/queue`

### 데이터 통합 패키지

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`

### 도구 (Tooling)

- `@konekti/cli`

## 핵심 사용 흐름

1. `konekti new`로 새로운 앱을 부트스트랩합니다.
2. `konekti g`로 모듈, 컨트롤러, 서비스, 리포지토리, 미들웨어, DTO를 생성합니다.
3. 명시적 DTO 바인딩 및 검증으로 요청 흐름을 구축합니다.
4. 인증, 메트릭, OpenAPI, 데이터 어댑터를 패키지 수준 임포트로 구성합니다.
5. 런타임 소유의 HTTP/부트스트랩 경로로 실행하고 확인합니다.

## 구조 설계 이유

- **CLI 중심 부트스트랩**을 통해 시작 경로를 일관되게 유지하고 문서화합니다.
- **패키지 로컬 정보**는 별도의 계획 레포지토리가 아닌 각 패키지의 README에 위치합니다.
- **패키지 간 계약**은 `docs/`에 아키텍처 및 참조 가이드로 보관됩니다.
- **기획은 GitHub Issues**에서 이루어지며, 제품 레포지토리 내부의 단계별 문서에 담지 않습니다.

## 문서 (Documentation)

여기서 시작하세요:

- `docs/README.md`
- `docs/getting-started/quick-start.md`
- `docs/concepts/architecture-overview.md`
- `docs/reference/package-surface.md`

릴리스 히스토리:

- `CHANGELOG.md`
- `https://github.com/konektijs/konekti/releases`

패키지 수준 문서:

- `packages/cli/README.md`
- `packages/http/README.md`
- `packages/runtime/README.md`
- `packages/redis/README.md`
- `packages/passport/README.md`
- `packages/openapi/README.md`
- `packages/graphql/README.md`
- `packages/metrics/README.md`
- `packages/cron/README.md`
- `packages/event-bus/README.md`
- `packages/microservices/README.md`
- `packages/websocket/README.md`
- `packages/queue/README.md`

## 문서화 규칙

- 루트 `README.md`는 프로젝트의 허브 역할을 합니다.
- `docs/`는 패키지 전체에 걸친 현재 정보를 관리합니다.
- `packages/*/README*.md`는 패키지별 API와 예시를 담습니다.
- 향후 작업 및 후속 조치는 GitHub Issues에서 관리합니다.

## 기여하기 (Contributing)

- 패키지 외부 인터페이스를 변경하는 경우, 해당 패키지의 README를 업데이트하세요.
- 패키지 간 계약을 변경하는 경우, 해당 `docs/` 가이드를 업데이트하세요.
- 향후 작업을 식별한 경우, 단계 상태를 글로 작성하는 대신 GitHub Issue를 열거나 업데이트하세요.
