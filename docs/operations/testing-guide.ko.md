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
| `pnpm verify:release-readiness` | 패키징된 CLI 검증을 포함한 공개 릴리스를 위한 최종 관문입니다. |

### 생성된 템플릿
CLI(`fluo g repo <Name>`) 사용 시 기본적으로 제공되는 템플릿은 다음과 같습니다.
- `<name>.repo.test.ts`: 비즈니스 로직을 위한 유닛 테스트 템플릿.
- `<name>.repo.slice.test.ts`: `createTestingModule`을 사용하는 통합 테스트 템플릿.

---

## 관련 문서
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
