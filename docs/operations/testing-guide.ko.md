# 테스트 가이드 (Testing Guide)

<p>
  <strong>한국어</strong> | <a href="./testing-guide.md">English</a>
</p>

이 문서는 fluo 프레임워크의 테스트 아키텍처와 검증 정책을 정의합니다. 프레임워크 기여자와 애플리케이션 개발자 모두가 신뢰할 수 있는 메타데이터 없는 시스템 동작 검증을 수행할 수 있도록 돕는 공식 지침서입니다.

## 이 문서가 필요한 경우

- **코어 기여**: `@fluojs/*` 패키지의 새로운 기능을 추가하거나 버그를 수정할 때.
- **플랫폼 작성**: 새로운 런타임이나 제3자 확장을 개발할 때.
- **애플리케이션 개발**: 비즈니스 로직, HTTP 라우트, 영속성 계층에 대한 테스트 스위트를 구축할 때.

---

## 검증 정책 (Verification Policy)

fluo는 암묵적인 테스트 커버리지보다 **명시적 검증(Explicit Verification)**을 우선합니다. 플랫폼 지향적인 모든 변경 사항은 다음 계층 구조를 통해 동작 안정성을 증명해야 합니다.

1.  **타입 안전성 (Type Safety)**: 모든 공개 API는 완전한 타입을 갖추어야 하며 `pnpm typecheck`를 통과해야 합니다.
2.  **유닛 격리 (Unit Isolation)**: 로직이 복잡한 프로바이더는 외부 의존성 없이 유닛 테스트를 수행해야 합니다.
3.  **모듈 배선 (Module Wiring)**: 데코레이터와 DI 토큰이 `TestingModule` 내에서 올바르게 해석되는지 확인합니다.
4.  **런타임 동등성 (Runtime Parity)**: 크로스 플랫폼 기능은 지원되는 모든 런타임(Node.js, Bun, Deno 등)에서 `platform-conformance` 하네스를 통과해야 합니다.

---

## 테스트 도구함 (`@fluojs/testing`)

`@fluojs/testing` 패키지는 모든 검증 활동의 공식 관문입니다.

### 핵심 유틸리티
- `createTestingModule()`: 모듈 수준 통합 테스트를 위한 기본 진입점입니다.
- `createTestApp()`: 엔드투엔드(E2E) 스타일 검증을 위해 전체 애플리케이션 인스턴스를 부트스트랩합니다.
- `TestingModuleRef`: 의존성 해석 및 디스패칭을 위해 컴파일된 테스트 환경에 대한 핸들을 제공합니다.

### 특화된 서브패스
- `@fluojs/testing/mock`: 고급 모킹 유틸리티 (`createMock`, `createDeepMock`).
- `@fluojs/testing/http`: 플루언트(Fluent) 요청 빌더 및 보안 principal 주입기.
- `@fluojs/testing/platform-conformance`: 크로스 런타임 검증을 위한 표준화된 테스트 스위트.

---

## 구현 레시피 (Recipes)

### 1. 프로바이더 오버라이드를 포함한 모듈 슬라이스
실제 DI 배선은 필요하지만 리포지토리나 서드파티 클라이언트와 같은 외부 협력자를 페이크(Fake)로 대체하고 싶을 때 사용합니다.

```ts
import { createTestingModule } from '@fluojs/testing';
import { vi } from 'vitest';

const fakeUserRepo = {
  create: vi.fn().mockResolvedValue({ id: '1' }),
  findById: vi.fn(),
};

const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, fakeUserRepo)
  .compile();

const service = await moduleRef.resolve(UserService);
```

### 2. 가드 및 인터셉터 검증
전체 네트워크 리스너를 실행하지 않고 요청 수준의 정책을 검증합니다.

```ts
const moduleRef = await createTestingModule({ rootModule: AppModule })
  .overrideGuard(AuthGuard)
  .overrideInterceptor(LoggingInterceptor)
  .compile();
```

### 3. E2E 스타일 HTTP 테스트
`createTestApp`을 사용하여 전체 요청 생명주기에 대한 높은 신뢰도의 검증을 수행합니다.

```ts
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

const response = await app
  .request('GET', '/users/me')
  .principal({ subject: 'user-1', roles: ['member'] })
  .send();

expect(response.status).toBe(200);
await app.close();
```

### 4. 영속성 경계 (Prisma/Drizzle)
모듈 배선은 실제와 동일하게 유지하되, CI 환경에서 네트워크/데이터베이스 결합을 피하기 위해 저수준 클라이언트 토큰을 오버라이드합니다.
- Prisma 기반 모듈의 경우 `PRISMA_CLIENT` 오버라이드.
- Drizzle 기반 모듈의 경우 `DRIZZLE_DATABASE` 오버라이드.

---

## 저장소 표준 (Repository Standards)

### 명령어
| 명령어 | 설명 |
| :--- | :--- |
| `pnpm test` | 워크스페이스 전체에서 Vitest 스위트를 실행합니다. |
| `pnpm verify` | Build → Typecheck → Lint → Test 순서로 실행합니다. |
| `pnpm verify:release-readiness` | 패키징된 CLI 검증을 포함한 공개 릴리스를 위한 읽기 전용 최종 관문입니다. 같은 verifier는 CI 전용 단건 publish preflight를 위해 `--target-package`, `--target-version`, `--dist-tag`도 받습니다. |
| `pnpm generate:release-readiness-drafts` | 릴리스 준비를 위해 release-readiness summary 산출물과 changelog 드래프트 블록을 명시적으로 씁니다. |
| `pnpm verify:public-export-tsdoc:baseline` | public-export TSDoc 기준을 전체 governed 패키지 소스 표면에 적용합니다. |

### CI shutdown flake attribution

반복되는 Vitest worker-timeout shutdown flake에 대한 canonical CI attribution 경로는 opt-in이며 evidence-only입니다.

- 조사할 `pnpm test` 또는 `pnpm vitest run ...` 실행에 `FLUO_VITEST_SHUTDOWN_DEBUG=1`을 설정합니다.
- 출력 디렉터리가 필요하면 `FLUO_VITEST_SHUTDOWN_DEBUG_DIR`로 덮어쓸 수 있으며, 기본값은 `.artifacts/vitest-shutdown-debug`입니다.
- 이 Vitest 통합은 실행이 unhandled error로 끝나거나 `onProcessTimeout`에 걸릴 때 현재 실행(current-run)의 JSON evidence를 남기며, 마지막 active module/test와 active handle/request class 요약을 함께 기록합니다.
- worker 프로세스도 signal-time snapshot을 남기므로, 메인 프로세스가 워커를 정리할 때 CI가 해당 워커의 마지막 file/suite/test 문맥을 보존할 수 있습니다.
- canonical full-suite CI 경로는 이제 workspace Vitest project(`packages`, `apps`, `examples`, `tooling`)를 각각 `pnpm vitest run --project ...`로 분리 실행하므로, 하나의 shutdown leak 때문에 전체 workspace가 단일 장수 실행으로 묶이지 않게 합니다.
- 분리된 workspace project가 의도적으로 비어 있다면 해당 Vitest project에 `passWithNoTests: true`를 설정하여 `pnpm vitest run --project ...`가 녹색 상태를 유지하고 monolithic workspace test command로 되돌아가지 않도록 합니다.
- CI는 `.artifacts/vitest-shutdown-debug/` 아래 project별 하위 디렉터리에 attribution artifact를 저장해 #1134 evidence path를 유지하면서도 각 workspace project의 shutdown trace를 분리 보존합니다.

이 경로는 attribution 전용으로 취급해야 합니다. 특정 leak 또는 teardown contract를 겨냥한 후속 이슈 전까지는 runtime behavior, pool 선택, timeout 값은 보존하십시오.

---

## 릴리스 Pre-flight 런북 (Release Pre-flight Runbook)

메인테이너는 자동화된 릴리스를 트리거하기 전에 모든 검증이 통과되었는지 확인해야 합니다.

### 1. 검증 체크리스트
- [ ] 로컬에서 `pnpm verify`를 실행하여 통과했는지 확인하십시오.
- [ ] public export가 TSDoc 기준을 따르는지 확인하십시오 (`pnpm lint`에 의해 검증됨).
- [ ] `pnpm verify:release-readiness`를 실행하여 intended publish surface에 대한 오류가 없는지 확인하십시오.

### 2. CI 전용 Preflight 실행
수동 워크플로 `.github/workflows/release-single-package.yml`은 한 번에 하나의 패키지를 배포하는 canonical publisher입니다. 이 워크플로는 특정 입력값으로 `pnpm verify:release-readiness`를 재사용합니다.

```bash
pnpm verify:release-readiness --target-package <package_name> --target-version <version> --dist-tag <tag> --write-summary
```

이 관문은 다음을 보장합니다:
1. 패키지가 **intended publish surface** 내에 있는지 확인합니다.
2. 내부 `@fluojs/*` 의존성 범위가 배포에 안전한지 확인합니다 (canonical `workspace:^` 형태).
3. 버전과 `dist-tag`가 올바르게 일치하는지 확인합니다 (예: `next` 태그에 안정 버전을 배포하지 않음).

매 실행마다 `release-readiness-summary.md` 산출물이 생성되어 preflight 성공 증거로 GitHub Release에 첨부됩니다.

---

## 관련 문서

- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
