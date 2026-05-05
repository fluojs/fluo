# 테스트 요구사항 (Testing Requirements)

<p><strong><kbd>한국어</kbd></strong> <a href="./testing-guide.md">English</a></p>

## 테스트 유형 (Test Types)

| 테스트 유형 | 필수 적용 표면 | 저장소 기준 도구 및 패턴 |
| --- | --- | --- |
| Unit | 네트워크나 외부 프로세스 의존성이 없는 순수 provider 로직, helper, 실패 분기 | Vitest를 직접 사용합니다. `@fluojs/testing/mock`은 명시적 double을 위한 `createMock(...)`, `createDeepMock(...)`를 제공합니다. |
| Integration | 하나의 애플리케이션 슬라이스 안에서 수행하는 실제 module graph 컴파일, provider override, DI visibility 점검 | `createTestingModule({ rootModule })`을 사용한 뒤 `.compile()` 전에 `overrideProvider(...)`, `overrideGuard(...)`, `overrideInterceptor(...)`, `overrideProviders(...)`를 적용합니다. |
| E2E 스타일 HTTP | 실제 HTTP 스택을 통과하는 request dispatch, guard, interceptor, DTO validation, response writing | `@fluojs/testing`의 `createTestApp({ rootModule })`을 사용한 뒤, app-level route assertion에는 `app.request(method, path).header(...).query(...).principal(...).body(...).send()`를 우선 사용합니다. 저장소 예제는 이 방식으로 `/health`, `/ready`, `/metrics`, auth, CRUD route를 검증합니다. |
| Platform conformance | 프레임워크 지향 플랫폼 패키지와 이식성에 민감한 adapter | 변경이 runtime 또는 adapter contract에 영향을 주는 경우 `@fluojs/testing/platform-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability`, `@fluojs/testing/fetch-style-websocket-conformance`를 사용합니다. |

## canonical fluo TDD ladder (Canonical fluo TDD Ladder)

fluo 기능을 테스트 주도 개발(TDD)로 만들 때는 다음 ladder를 사용합니다.

1. **Unit**: 빠른 service, controller, helper, failure branch 테스트는 `src/**` 아래 source 가까이에 둡니다. 클래스를 직접 구성하고 명시적 fake를 넘기거나, typed double이 설정을 명확하게 만들 때 `@fluojs/testing/mock`의 `createMock(...)`, `createDeepMock(...)`, `asMock(...)`, `mockToken(...)` 헬퍼를 사용합니다.
2. **Slice/module integration**: role-specific slice 테스트에서는 `createTestingModule({ rootModule })` 또는 `Test.createTestingModule({ rootModule })`로 프로덕션과 같은 형태의 module graph를 컴파일합니다. 이 계층은 DI wiring, provider visibility, lifecycle hook, 그리고 `.compile()` 전 명시적 provider/guard/interceptor/filter/module override를 검증하는 위치입니다.
3. **HTTP e2e-style**: request-pipeline 테스트는 전용 app-level test 영역에 두고 `createTestApp({ rootModule })`로 virtual app을 만듭니다. header, query parameter, request body, principal, response assertion에는 기본 route assertion helper인 `app.request(...).send()`를 사용합니다. 더 낮은 수준의 dispatch path 자체가 계약일 때만 `app.dispatch(...)`를 사용합니다.
4. **Platform/conformance**: `@fluojs/testing/*-conformance`와 portability harness subpath는 adapter/runtime package 전용으로 남겨 둡니다. 애플리케이션 기능 테스트는 platform-facing contract를 증명하는 경우가 아니면 이 harness를 사용하지 않습니다.

권장 프로젝트 구조:

```txt
src/users/
  users.service.test.ts
  users.controller.test.ts
  users.slice.test.ts

test/
  app.e2e.test.ts
```

NestJS에서 온 경우 metadata 기반 추론을 기대하지 말고 개념을 명시적으로 대응시키세요.

| NestJS 패턴 | fluo 패턴 |
| --- | --- |
| `Test.createTestingModule({ imports: [...] })` | 검증할 slice를 import하는 명시적 root module과 함께 `createTestingModule({ rootModule })` 또는 `Test.createTestingModule({ rootModule })`을 사용합니다. |
| 초기화된 Nest app에 대한 Supertest e2e | 네트워크 소켓을 열지 않고 `createTestApp({ rootModule })`을 만든 뒤 `app.request(method, path).send()`를 사용합니다. |
| 기본 suffix로 `.spec.ts` 사용 | 기본 suffix는 `.test.ts`를 사용하고, scope가 중요하면 `.slice.test.ts`, `.e2e.test.ts`처럼 role-specific 이름을 사용합니다. |

fluo의 테스트 설정은 런타임 모델과 같습니다. 표준 decorator, 명시적 DI token, 작성자가 정의한 module graph를 따릅니다. 테스트는 컴파일할 `rootModule`을 이름으로 지정해야 하며, fluo는 TypeScript design metadata나 legacy reflection flag로 dependency를 추론하지 않습니다.

수동 `FrameworkRequest`/`FrameworkResponse` stub, `makeRequest(...)`, raw `FluoFactory.create(...)`, direct `app.dispatch(...)` 테스트는 framework internal, adapter/runtime, compatibility contract에 남겨 둡니다. 이들은 기본 app-developer HTTP 경로보다 의도적으로 낮은 수준의 테스트입니다.

## 명령어 (Commands)

| 명령어 | 용도 |
| --- | --- |
| `pnpm test` | 저장소 루트에서 workspace Vitest 스위트를 실행합니다. |
| `pnpm vitest run --project packages` | release readiness check에서 쓰는 split project layout으로 package 테스트를 실행합니다. |
| `pnpm vitest run --project apps` | release readiness check에서 쓰는 split project layout으로 app project 테스트를 실행합니다. |
| `pnpm vitest run --project examples` | release readiness check에서 쓰는 split project layout으로 example application 테스트를 실행합니다. |
| `pnpm vitest run --project tooling` | release readiness check에서 쓰는 split project layout으로 tooling 테스트를 실행합니다. |
| `pnpm verify` | build, typecheck, lint, test 순서의 저장소 검증 체인을 실행합니다. |
| `pnpm verify:platform-consistency-governance` | testing 또는 release requirement가 바뀔 때 governed docs와 contract consistency를 검증합니다. |
| `pnpm verify:release-readiness` | `pnpm build`, `pnpm typecheck`, split Vitest projects, `pnpm --dir packages/cli sandbox:matrix`, governance checks를 포함한 canonical release gate를 실행합니다. |

## 커버리지 요구사항 (Coverage Requirements)

- 저장소는 `package.json`이나 governance tooling에서 단일 전역 라인 커버리지 비율을 정의하지 않습니다. 커버리지는 하나의 숫자 임계값이 아니라 contract surface 기준으로 강제됩니다.
- 모든 동작 변경은 영향을 받은 package, example, tooling project 안에서 테스트를 추가하거나 갱신해야 합니다. 가장 가까운 기존 `*.test.ts` 파일이 기본 배치 위치입니다.
- Module wiring 변경은 provider registration, override, DI resolution이 계속 실행되도록 `createTestingModule(...)` 기반 integration coverage를 유지해야 합니다.
- Request-facing HTTP 변경은 `createTestApp(...).request(...).send()` 기반 request-level coverage를 유지해야 합니다. Direct dispatch test는 low-level dispatch boundary 자체가 검토 대상인 경우에만 적합합니다.
- Platform 및 adapter 변경은 runtime portability에 영향을 줄 때 `@fluojs/testing` harness subpath를 통한 conformance 또는 portability coverage를 유지해야 합니다.
- Release-governed testing 변경은 `pnpm verify:release-readiness`가 사용하는 split Vitest project 모델에서 녹색 상태를 유지해야 합니다. 로컬 `pnpm test` 통과만으로 그 split project run을 대체하지 않습니다.
