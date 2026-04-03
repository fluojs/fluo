# 첫 번째 기능까지 가는 경로

<p><a href="./first-feature-path.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 `quick-start.ko.md` 바로 다음 단계에 해당합니다. 목표는 단순합니다. "앱이 뜬다"에서 끝나지 않고, **하나의 실제 기능을 추가하고, 문서화하고, 테스트하고, 런타임 snapshot까지 확인하는 경로**를 레포 내부 문서만으로 따라가게 만드는 것입니다.

### 관련 문서

- `./quick-start.ko.md`
- `./generator-workflow.ko.md`
- `../operations/testing-guide.ko.md`
- `../concepts/openapi.ko.md`
- `../reference/package-chooser.ko.md`
- `../../examples/minimal/README.ko.md`
- `../../examples/realworld-api/README.ko.md`

## quick start 다음의 공식 경로

`konekti new starter-app`과 `pnpm dev`가 이미 동작한다면, 권장되는 다음 순서는 이렇습니다.

1. **minimal 예제**를 읽고 가장 작은 요청 경로를 이해합니다.
2. **realworld-api 예제**를 읽고 실제 모듈 경계, DTO 검증, 명시적 DI를 봅니다.
3. CLI로 작은 도메인 슬라이스를 하나 생성합니다.
4. Request DTO 검증과 응답 형태를 추가합니다.
5. 테스트를 작성합니다.
6. `konekti inspect --json`으로 런타임 snapshot을 내보내고 Studio에서 확인합니다.

이 순서는 패키지 README 사이를 무작정 오가는 대신, 첫 번째 실전 루프를 레포 내부 markdown만으로 따라가게 해 줍니다.

## 1단계: 가장 작은 실행 형태부터 보기

먼저 `../../examples/minimal/README.ko.md`를 읽으세요.

이 예제는 다음을 보여줍니다.

- runtime-owned bootstrap
- 표준 데코레이터 사용
- 단일 controller/service 요청 경로
- 기본 `/health`, `/ready`
- 가장 작은 테스트 경로

NestJS에서 넘어왔다면, 여기서 가장 먼저 익혀야 하는 차이는 두 가지입니다.

- `@Injectable()`가 필요 없다는 점
- `@Inject([...])`로 의존성을 명시한다는 점

## 2단계: 실제 모듈 경계로 이동

그 다음 `../../examples/realworld-api/README.ko.md`를 읽으세요.

이 예제는 다음을 추가합니다.

- `imports` / `exports` 모듈 조합
- typed config
- Request DTO 검증
- 명시적 repository / service wiring
- 현실적인 CRUD 표면
- integration + e2e 스타일 테스트

현재 레포 안에서 스타터를 넘어서는 기능 구조를 배우기엔 이 예제가 가장 좋은 기준점입니다.

## 3단계: 첫 도메인 슬라이스 생성

CLI로 작은 기능 경로를 만드세요.

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate request-dto create-user
konekti generate response-dto user-profile
```

생성 후 권장 읽기 순서:

1. 생성된 DTO
2. 생성된 repo
3. 생성된 service
4. 생성된 controller
5. 생성된 module

generator 출력과 auto-registration 규칙이 더 필요하면 `./generator-workflow.ko.md`로 이어가세요.

## 4단계: 요청 경계를 명시적으로 만들기

첫 기능은 Konekti의 표준 경계 분리를 그대로 따르는 것이 좋습니다.

- request binding은 `@konekti/http`
- validation은 `@konekti/validation`
- output shaping이 필요하면 `@konekti/serialization`

멘탈 모델은 다음과 같습니다.

```text
controller route
  -> request DTO binding
  -> validation
  -> service call
  -> optional serialization
```

실제 예제가 필요하면 `examples/realworld-api/src/users/*`를 기준으로 읽으면 됩니다.

## 5단계: OpenAPI로 기능 문서화

공개 HTTP API라면 `@konekti/openapi`를 붙여 generated contract를 만드는 것을 권장합니다.

- canonical artifact: `GET /openapi.json`
- optional interactive viewer: Swagger UI via `GET /docs`

교차 패키지 관점이 필요하면 `../concepts/openapi.ko.md`, 패키지 API 자체가 필요하면 `../../packages/openapi/README.ko.md`를 읽으세요.

## 6단계: 기능이 커지기 전에 테스트 추가

기능이 커진 뒤에 테스트를 붙이지 마세요.

`../operations/testing-guide.ko.md`를 기준으로 일찍 하나를 고르세요.

- 순수 로직용 unit test
- 모듈 wiring 검증용 integration/slice test
- 라우트 동작 검증용 e2e 스타일 dispatch test

현재 예제들은 이 테스트 배치와 naming 스타일의 기준점 역할을 합니다.

## 7단계: 런타임 snapshot 확인

기능을 추가했다면 런타임 플랫폼 snapshot도 내보내세요.

```bash
konekti inspect ./src/app.module.mjs --json
konekti inspect ./src/app.module.mjs --mermaid
konekti inspect ./src/app.module.mjs --timing
```

이걸로 얻는 것:

- Studio가 읽는 canonical JSON snapshot
- Mermaid 기반 dependency chain
- bootstrap timing payload

그다음 `@konekti/studio`에서 JSON을 열어 다음을 확인합니다.

- component readiness
- component health
- `fixHint`가 있는 diagnostics
- ownership details
- dependency chains

## 8단계: 다음 패키지는 목적 기반으로 고르기

첫 기능 이후에는 감으로 패키지를 붙이지 마세요.

다음 단계는 `../reference/package-chooser.ko.md`에서 목적별로 고르세요.

- auth
- metrics
- OpenAPI
- queue/cron/event-bus
- Redis/Prisma/Drizzle
- GraphQL
- caching

이렇게 하면 온보딩이 웹사이트 없이도 repo-native markdown 경로로 유지됩니다.

## 첫 기능 체크리스트

스타터 앱에 첫 실전 슬라이스를 추가할 때는 아래를 체크하세요.

- [ ] route 존재
- [ ] service 존재
- [ ] module wiring이 명시적임
- [ ] 입력이 복잡하면 Request DTO validation 존재
- [ ] 응답 형태가 의도적으로 설계됨
- [ ] 최소 1개 테스트 존재
- [ ] 공개 HTTP surface라면 OpenAPI contract 존재
- [ ] runtime snapshot을 export해서 확인 가능함

## 다음에 읽을 곳

- 모듈/DI를 더 깊게 보고 싶다 → `../concepts/di-and-modules.ko.md`
- API 문서화를 붙이고 싶다 → `../concepts/openapi.ko.md`
- 테스트 레시피가 더 필요하다 → `../operations/testing-guide.ko.md`
- 작업별 패키지 선택이 필요하다 → `../reference/package-chooser.ko.md`
- runnable example부터 더 보고 싶다 → `../../examples/README.ko.md`
