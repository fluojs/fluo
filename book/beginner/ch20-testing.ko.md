<!-- packages: @fluojs/testing -->
<!-- project-state: FluoBlog v1.17 -->

# Chapter 20. Testing

이 장은 FluoBlog의 서비스와 HTTP 흐름을 자동화된 테스트로 검증하는 방법을 설명합니다. Chapter 19가 운영 중 상태를 관찰하는 방법을 다뤘다면, 이 장은 배포 전에 동작을 반복 가능하게 검증하는 안전망을 구축합니다.

## Learning Objectives
- Vitest와 `@fluojs/testing`을 이용한 테스트 환경을 구축합니다.
- `fluo`에서 단위 테스트, 통합 테스트, E2E 스타일 HTTP 테스트의 차이점을 이해합니다.
- `createTestingModule`을 사용하여 모듈 그래프 컴파일과 프로바이더 오버라이드 중심의 통합 테스트를 구성하는 방법을 배웁니다.
- 테스트 중에 프로바이더를 모의 객체나 가짜 객체로 교체합니다.
- `createTestApp`을 사용하여 실제 요청 파이프라인을 검증하는 HTTP 테스트를 구현합니다.
- FluoBlog의 컨트롤러와 서비스를 위한 자동화된 테스트를 작성합니다.

## Prerequisites
- Chapter 5와 Chapter 13 완료.
- Chapter 15부터 Chapter 19까지 완료.
- TypeScript 비동기 코드와 테스트 러너의 기본 사용법 이해.

## 20.1 Why Testing Matters in fluo
표준 데코레이터와 명시적인 의존성 주입(DI)을 기반으로 구축된 프레임워크인 `fluo`에서는 테스트 구성이 비교적 직접적입니다. `fluo`는 숨겨진 메타데이터나 글로벌 상태에 의존하지 않기 때문에, 테스트 스위트에서 필요한 컴포넌트를 인스턴스화하고 연결할 수 있습니다. 이러한 "명시적 설계(Explicit by Design)" 접근 방식은 백엔드 애플리케이션 테스트를 어렵게 만드는 보이지 않는 결합을 줄입니다.

테스트는 다음 사항을 보장합니다:
- 비즈니스 로직이 올바르게 작동하고 에지 케이스를 예측 가능한 방식으로 처리하는지 확인합니다.
- API 엔드포인트가 예상된 데이터, 헤더 및 상태 코드를 반환하는지 확인합니다.
- 보안 가드, 정책 및 인터셉터가 의도한 대로 작동하는지 확인합니다.
- 리팩토링이 기존 기능을 망가뜨리지 않는지 확인합니다 (회귀 테스트).
- 애플리케이션 아키텍처가 시간이 지나도 결합도가 낮고 유지보수 가능한 상태로 유지되는지 확인합니다.

### 20.1.1 Testing as Documentation
잘 작성된 테스트 스위트는 동작 문서 역할을 합니다. 미래의 개발자(미래의 자신 포함)에게 서비스가 어떻게 동작해야 하는지, 의존성이 무엇인지 구체적으로 보여줍니다. `fluo`에서 테스트 모듈 설정은 프로덕션 모듈 설정을 반영하므로, 애플리케이션의 서로 다른 부분 사이의 관계도 코드로 확인할 수 있습니다.

### 20.1.2 The ROI of Automated Testing
테스트를 작성하는 데는 초기에 시간이 걸리지만, 그 투자 수익률(ROI)은 큽니다. 자동화된 테스트를 통해 배포 전 신호를 얻고, 수동 QA에 드는 시간을 줄이며, 버그가 프로덕션에 도달하기 전에 잡아낼 수 있습니다. FluoBlog와 같이 빠르게 변하는 프로젝트에서 테스트는 개발 속도와 안정성을 함께 유지하기 위한 핵심 장치입니다.

### 20.1.3 The Testing Pyramid in Fluo
건강한 테스트 전략은 "테스트 피라미드"를 따릅니다. 즉, 기반이 되는 수많은 빠른 단위 테스트, 중간 계층의 통합 테스트, 그리고 최상위의 소수 E2E 테스트로 구성됩니다. Fluo의 도구들은 개발 시간이 많이 쓰이는 아래 두 계층에 맞춰져 있습니다. 이 테스트들을 작성하기 쉽고 빠르게 실행되도록 만들면 코드베이스를 깨끗하고 신뢰할 수 있게 유지하는 테스트 문화가 자리 잡습니다.

### 20.1.4 Mocking the Clock: Dealing with Time
시간은 "불안정한 테스트(Flaky Tests, 무작위로 통과하거나 실패하는 테스트)"의 빈번한 원인입니다. 로직이 현재 시간에 의존한다면(예: 게시물이 "오늘" 생성되었는지 확인), 자정에 테스트를 실행할 때 실패할 수 있습니다. Fluo는 Vitest의 시간 조작 기능과 연동됩니다. 특정 시점에 시간을 고정하거나 5분을 진행시킨 후, 테스트가 실제로 언제 실행되는지와 상관없이 시간 민감 로직이 예상대로 동작하는지 검증할 수 있습니다.

## 20.2 Setting Up the Environment
이 장에서는 **Vitest**를 기본 테스트 러너로 사용합니다. Vitest는 빠르고 Vite와 호환되며 TypeScript와 잘 맞기 때문입니다. Vitest는 Jest에 익숙한 사용자에게 친숙한 API를 제공하면서도 현대적인 TypeScript 프로젝트에서 좋은 실행 성능을 보여줍니다.

필요한 의존성을 설치합니다:
```bash
pnpm add -g vitest
pnpm add -D @fluojs/testing @babel/core
```

`@babel/core`가 필요한 이유는 `@fluojs/testing/vitest`가 테스트 실행 중에 표준 데코레이터를 처리하기 위해 Babel 플러그인을 사용하기 때문입니다. TypeScript가 타입을 처리하는 동안 Babel은 테스트 중에도 런타임과 동일한 표준 데코레이터 동작을 보장합니다.

### Vitest Configuration
프로젝트 루트에 `vitest.config.ts` 파일을 생성합니다:

```typescript
import { defineConfig } from 'vitest/config';
import { fluoBabelDecoratorsPlugin } from '@fluojs/testing/vitest';

export default defineConfig({
  plugins: [
    fluoBabelDecoratorsPlugin(),
  ],
  test: {
    globals: true,
    environment: 'node',
    // src 내부와 모든 __tests__ 디렉토리의 테스트를 포함합니다
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
```

`fluoBabelDecoratorsPlugin`은 복잡한 설정 없이도 Vitest가 `fluo`의 표준 데코레이터를 이해할 수 있게 해주는 다리 역할을 합니다. 이 설정을 통해 테스트 환경이 실제 프로덕션 런타임의 데코레이터 처리 방식과 맞춰집니다.

### 20.2.1 Global Setup and Teardown
규모가 큰 프로젝트의 경우, 모든 테스트가 실행되기 전에 수행해야 할 작업(예: 테스트 데이터베이스 초기화)과 테스트 종료 후의 정리 작업이 필요할 수 있습니다. Vitest는 설정에서 `setupFiles` 배열을 정의할 수 있게 해줍니다. 이곳은 글로벌 환경 변수를 설정하거나 단언문을 단순화하는 커스텀 매처(matcher)를 등록하기에 적합한 장소입니다.

### 20.2.2 Coverage and Reporting
작성한 코드가 얼마나 테스트되었는지 아는 것은 중요합니다. Vitest는 `v8`이나 `istanbul` 같은 도구를 사용하여 코드 커버리지를 측정하는 기능을 내장하고 있습니다. `vitest run --coverage` 명령을 실행하면 코드의 어느 라인이 테스트되었는지 보여주는 보고서를 생성할 수 있습니다. 핵심 비즈니스 로직과 보안이 중요한 영역에서는 높은 커버리지를 목표로 하십시오.

## 20.3 Integration Testing with createTestingModule
`createTestingModule`은 한 애플리케이션 슬라이스 안에서 실제 모듈 그래프를 컴파일하고, 필요한 프로바이더만 오버라이드하면서 DI 연결 상태를 검증하는 통합 테스트 표면입니다. 테스트 대역을 주입해 특정 의존성을 제어할 수는 있지만, 이 범주는 순수 단위 테스트가 아니라 모듈 그래프 수준의 통합 범위에 해당합니다.

### The Service to Test
`PostService`를 예로 보겠습니다:

```typescript
@Inject(PostRepository)
export class PostService {
  constructor(private readonly repo: PostRepository) {}

  async findOne(id: string) {
    const post = await this.repo.findById(id);
    if (!post) throw new Error('Post not found');
    return post;
  }
}
```

### The Test Suite
`createTestingModule`을 사용하여 테스트를 위한 최소한의 모듈 그래프를 컴파일합니다. 이는 오직 테스트만을 위한 미니 DI 컨테이너처럼 작동합니다.

```typescript
import { createTestingModule } from '@fluojs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PostService } from './post.service';
import { PostRepository } from './post.repository';

describe('PostService', () => {
  let service: PostService;
  let mockRepo: any;

  beforeEach(async () => {
    // 1. 모의 구현(mock implementation) 정의
    mockRepo = {
      findById: vi.fn(),
    };

    // 2. 테스트 모듈 생성
    const module = await createTestingModule({
      providers: [PostService],
    })
      .overrideProvider(PostRepository, mockRepo)
      .compile();

    // 3. 테스트하려는 인스턴스 해결(resolve)
    service = await module.resolve(PostService);
  });

  it('should find a post by id', async () => {
    mockRepo.findById.mockResolvedValue({ id: '1', title: 'Hello fluo' });

    const post = await service.findOne('1');

    expect(post.title).toBe('Hello fluo');
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });

  it('should throw if post is not found', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.findOne('999')).rejects.toThrow('Post not found');
  });
});
```

이 패턴, **모의(Mock) -> 컴파일 -> 해결(Resolve) -> 실행(Act) -> 단언(Assert)** 는 `createTestingModule` 기반 통합 테스트의 핵심입니다. 실제 모듈 그래프와 DI 해석을 유지하면서도 필요한 의존성만 통제할 수 있어서, 테스트가 결정론적이면서도 현재 애플리케이션 슬라이스의 연결 상태를 함께 검증해 줍니다.

### 20.3.2 Testing Asynchronous Logic
비동기 코드는 백엔드 개발의 일반적인 형태입니다. Fluo의 `createTestingModule`과 Vitest의 `async/await` 지원을 사용하면 이러한 작업을 순서대로 테스트할 수 있습니다. 성공적인 완료, 예상된 거부(rejection), 그리고 여러 비동기 작업이 특정 순서대로 완료되어야 하는 타이밍 문제까지 검증할 수 있습니다. `vi.useFakeTimers()`를 사용하면 실제로 시간을 기다리지 않고도 타임아웃이나 재시도 로직을 테스트할 수 있습니다.

### 20.3.3 Lifecycle Hooks in Tests
때로는 프로바이더가 `onModuleInit`이나 `onApplicationShutdown`과 같은 라이프사이클 이벤트를 올바르게 처리하는지 테스트해야 할 때가 있습니다. Fluo의 테스트 모듈은 `compile()` 및 `close()` 단계에서 이러한 훅들을 트리거합니다. 이를 통해 모의 데이터베이스 연결 수립이나 캐시 정리와 같은 초기화 및 정리 로직을 테스트 스위트의 일부로 검증할 수 있습니다.

## 20.4 Provider Overrides
`fluo`는 실제 컴포넌트를 테스트 대역(test double)으로 교체하는 여러 가지 방법을 제공합니다. 이 기능을 사용하면 외부 시스템의 불안정성은 제거하면서도, 테스트하려는 모듈의 DI 연결과 실행 흐름은 그대로 검증할 수 있습니다.

- **`overrideProvider(token, value)`**: 특정 토큰을 값(객체 또는 인스턴스)으로 교체합니다.
- **`overrideProviders([[token, value], ...])`**: 여러 토큰을 한 번에 교체합니다.

### Mocks vs Fakes
- **모의 객체(Mock)**: 호출 기록을 남기고 반환 값을 제어할 수 있는 객체입니다(예: `vi.fn()`). 상호작용을 검증하고 "연결 상태를 확인"할 때 좋습니다.
- **가짜 객체(Fake)**: 지름길로 구현된 실제 작동 구현체입니다(예: `InMemoryPostRepository`). 실제 데이터베이스 없이 상태 중심 테스트를 할 때 좋습니다.

```typescript
// 가짜(Fake) 구현체 사용 예시
class FakePostRepository {
  private data = new Map();
  async findById(id: string) { return this.data.get(id); }
  async save(post: any) { this.data.set(post.id, post); }
}

const module = await createTestingModule({ providers: [PostService] })
  .overrideProvider(PostRepository, new FakePostRepository())
  .compile();
```

### 20.4.1 Spies and Verification
때로는 프로바이더를 완전히 교체하지 않고 단지 "관찰"만 하고 싶을 때가 있습니다. Vitest의 `vi.spyOn`을 사용하면 기존 메서드를 래핑하여 올바른 인자와 함께 호출되었는지 확인할 수 있습니다. 이는 실제 작업이 수행되어야 하지만 동시에 호출 여부도 확인해야 하는 로깅이나 이벤트 발행 같은 횡단 관심사(cross-cutting concerns) 테스트에 유용합니다.

### 20.4.2 Mocking Third-Party Modules
서비스가 외부 라이브러리(예: `axios`나 `aws-sdk`)에 의존하는 경우, Vitest의 `vi.mock()`을 사용하여 모듈 수준에서 모의해야 합니다. 이는 테스트가 실제 네트워크 요청을 보내는 것을 방지하여 인터넷 연결 없이도 빠르고 안정적으로 실행되도록 합니다.

### 20.4.3 Mocking Config and Environment
실제 애플리케이션에서 프로바이더들은 종종 설정 값에 의존합니다. 테스트 중에는 로컬 `.env` 파일에 의존하지 않는 편이 안전합니다. 테스트를 위해 미리 정의된 값을 반환하는 모의 객체로 `ConfigService`를 교체할 수 있습니다. 이를 통해 테스트의 이식성을 유지하고 실행 중인 특정 환경에 의존하지 않게 만들 수 있습니다.

```typescript
const module = await createTestingModule({ providers: [PostService] })
  .overrideProvider(ConfigService, {
    get: vi.fn().mockReturnValue('test-secret'),
  })
  .compile();
```

### 20.4.4 Dynamic Module Overrides
때로는 단일 프로바이더가 아닌 모듈 전체를 교체해야 할 때가 있습니다. Fluo의 테스트 프레임워크는 임포트된 모듈을 테스트용 버전으로 교체할 수 있게 합니다. 이는 `MailModule`이나 `StripeModule`과 같은 외부 통합 모듈을 테스트할 때 특히 유용한데, 프로바이더 세트 전체를 테스트를 위한 일관된 모의 객체나 가짜 객체 세트로 교체하고 싶을 때 사용합니다.

## 20.5 E2E-Style HTTP Testing with createTestApp
`createTestApp`은 요청 디스패치, 가드, 인터셉터, DTO 검증, 응답 작성을 포함한 실제 HTTP 파이프라인을 실행하는 E2E 스타일 HTTP 테스트 표면입니다. 실제 네트워크 소켓만 열지 않을 뿐, 요청 처리 스택 자체는 프로덕션 경로와 같은 방식으로 검증합니다.

실제 네트워크 서버를 시작하는 대신, 가상 요청 디스패치 시스템을 제공하는 `createTestApp`을 사용합니다. 이는 테스트 속도와 안정성을 높이면서도 전체 요청 라이프사이클이 올바르게 구성되었는지 확인합니다.

### The Test Case
```typescript
import { createTestApp } from '@fluojs/testing';
import { AppModule } from './app.module';

describe('PostController (E2E-style HTTP)', () => {
  let app: any;

  beforeAll(async () => {
    // 테스트 스위트를 위해 앱을 한 번만 초기화합니다
    app = await createTestApp({ rootModule: AppModule });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /posts should return a list of posts', async () => {
    const response = await app
      .request('GET', '/posts')
      .send();

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
```

### 20.5.1 Mocking the Principal
경로가 사용자 세션을 확인하는 가드에 의해 보호되는 경우, `.principal()`을 사용하여 로그인된 사용자를 시뮬레이션할 수 있습니다. 이는 모든 테스트에서 전체 로그인 흐름(JWT 획득 등)을 수행할 필요 없이 경로의 동작 자체에 집중할 수 있게 해줍니다.

```typescript
it('POST /posts should create a new post for admin', async () => {
  const response = await app
    .request('POST', '/posts')
    .principal({ subject: 'admin-user', roles: ['admin'] })
    .body({ title: 'Standard-First', content: 'Fluent and fast.' })
    .send();

  expect(response.status).toBe(201);
  expect(response.body.authorId).toBe('admin-user');
});
```

### 20.5.2 Testing Exception Filters
통합 테스트는 커스텀 예외 필터(Exception Filter)가 잘 작동하는지 확인하기에 적합한 장소입니다. 알려진 에러 조건을 발생시키고 응답 바디가 예상한 에러 형식(예: RFC 7807 Problem Details 표준)과 일치하는지 확인할 수 있습니다. 이를 통해 문제가 발생했을 때도 API의 일관성을 유지할 수 있습니다.

### 20.5.3 Testing Middleware and Headers
통합 테스트는 커스텀 미들웨어와 헤더 처리 로직이 올바른지 확인하기에 적합한 장소입니다. 가상 요청에 특정 헤더를 포함해 보내고, 애플리케이션이 예상한 헤더로 응답하는지 혹은 입력에 따라 올바른 로직을 수행하는지 검증할 수 있습니다. 이러한 세부적인 검증을 통해 API의 "HTTP 규약(HTTP Contract)"이 지켜지는지 확인할 수 있습니다.

### 20.5.4 Simulating Network Failures in Integration
`createTestApp`은 가상 시스템이지만, 기반 데이터 프로바이더를 모의함으로써 네트워크 수준의 실패를 여전히 시뮬레이션할 수 있습니다. 예를 들어 `PrismaService`가 타임아웃 에러를 던지도록 모의하고, 애플리케이션이 적절한 `504 Gateway Timeout` 또는 `503 Service Unavailable` 응답을 반환하는지 확인할 수 있습니다. 이를 통해 네트워크 하드웨어를 실제로 망가뜨리지 않고도 애플리케이션의 복원력을 테스트할 수 있습니다.

## 20.6 Mocking with createMock and createDeepMock
복잡한 클래스의 경우 수십 개의 메서드를 수동으로 모의 객체로 만드는 것은 번거롭고 실수가 생기기 쉽습니다. `@fluojs/testing/mock`은 JavaScript Proxy를 사용하여 타입을 자동으로 모의하는 헬퍼를 제공합니다. 덕분에 테스트 설정은 짧아지고, 실제로 검증하고 싶은 동작에 더 많은 주의를 쓸 수 있습니다.

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

// 특정 메서드만 정의하는 얕은 모의 객체 생성
const repo = createMock<PostRepository>({ 
  findAll: vi.fn().mockResolvedValue([]) 
});

// 모든 메서드가 자동으로 모의되는 깊은 모의 객체 생성
// 의존성이 많은 서비스를 테스트할 때 유용합니다
const mailer = createDeepMock(MailService);
mailer.send.mockResolvedValue(true);
```

### 20.6.1 Auto-Mocking DI Tokens
`createTestingModule`은 명시적으로 정의되지 않은 모든 프로바이더를 "자동 모의(Auto-Mock)"하도록 설정할 수도 있습니다. 이는 한두 개의 의존성만 관심 있는 큰 서비스를 테스트할 때 시간을 줄여 줍니다. Fluo는 다른 모든 의존성에 대해 깊은 모의 객체를 자동으로 주입하여, 많은 상용구 코드 없이도 클래스를 인스턴스화할 수 있게 합니다.

### 20.6.2 The Power of Proxies in Mocking
`createMock` 헬퍼는 ES6 Proxy를 사용하여 메서드 호출과 속성 접근을 가로챕니다. 이는 모의 객체의 모든 메서드를 일일이 정의할 필요가 없음을 의미합니다. 프록시는 모든 호출을 자동으로 처리하며, 메서드가 명시적으로 정의되지 않은 경우 기본 모의 함수를 반환합니다. 이를 통해 테스트 설정이 더 단순해지고 서비스 인터페이스 변경에도 대응하기 쉬워집니다. 서비스에 새로운 메서드를 추가하더라도, 해당 메서드를 구체적으로 검증해야 하는 테스트가 아니라면 기존의 모든 모의 객체를 업데이트할 필요가 없습니다.

### 20.6.3 Type-Safe Mocks with TypeScript
Fluo 테스트 유틸리티의 큰 장점 중 하나는 TypeScript와의 깊은 통합입니다. `createMock<T>`를 사용하면 모의하려는 메서드에 대해 전체 자동 완성 및 타입 체크 기능을 활용할 수 있습니다. 이는 메서드 이름의 오타나 잘못된 인자 타입으로 인해 발생하는 테스트 버그를 방지합니다. 타입 안전한 모의 객체는 테스트 코드가 프로덕션 코드와 동기화된 상태를 유지하도록 돕고, 애플리케이션이 성장할수록 유지보수 부담을 줄여줍니다.

## 20.7 Best Practices for FluoBlog Testing
1.  **프레임워크를 테스트하지 마세요**: `@Get()`이 작동하는지가 아니라, 애플리케이션의 비즈니스 로직에 집중하세요. `fluo`가 라우팅을 처리한다고 전제하고, 해당 경로가 호출되었을 때 작성한 코드가 무엇을 하는지 테스트하세요.
2.  **데이터베이스에는 가짜(Fake)를 사용하세요**: 통합 테스트는 실제 테스트용 데이터베이스(예: Docker의 PostgreSQL)를 사용할 수 있지만, 단위 테스트는 속도를 위해 항상 모의 객체나 가짜를 사용해야 합니다.
3.  **리소스 정리**: 리소스를 해제하기 위해 항상 `await app.close()` 또는 `await module.close()`를 호출하세요. 이는 메모리 누수와 테스트 러너가 종료되지 않는 문제를 방지합니다.
4.  **보안을 위한 통합 테스트**: 항상 가드와 RBAC 로직은 통합 테스트에서 테스트하세요. 단위 테스트는 대개 이를 우회하므로, 통합 테스트가 실제 보안을 검증하는 곳입니다.
5.  **결정론적 테스트**: 테스트에서 `Date.now()`나 랜덤 숫자를 직접 사용하는 것을 피하세요. Vitest의 시간 여행 기능(`vi.useFakeTimers()`)을 사용하여 테스트가 실행될 때마다 동일하게 동작하도록 보장하세요.

### 20.7.1 Test-Driven Development (TDD) with Fluo
테스트 주도 개발(TDD)은 실제 구현을 작성하기 *전에* 테스트를 먼저 작성하는 워크플로우입니다. Fluo의 명시적인 의존성 관리는 TDD를 적용하기 좋은 구조를 제공합니다. 서비스의 인터페이스와 그 동작을 검증하는 테스트를 정의하는 것부터 시작하세요. 어떤 의존성을 모의(mock)해야 하는지 정확히 알고 있기 때문에, 테스트 모듈을 먼저 구축하고 테스트가 통과할 때까지 서비스 로직을 구현할 수 있습니다. 이러한 "Red-Green-Refactor" 사이클은 코드가 테스트 커버리지와 명확한 아키텍처를 갖춘 상태로 발전하도록 돕습니다.

### 20.7.2 Naming and Organizing Your Tests
대규모 테스트 스위트를 관리하려면 조직화가 핵심입니다. 단위 테스트의 경우 `*.test.ts`, 통합 테스트의 경우 `*.spec.ts` 또는 `*.int.ts`와 같이 일관된 명명 규칙을 따르세요. 테스트를 모듈이나 기능별로 그룹화하여 찾기 쉽게 만드세요. 각 테스트 파일 내에서는 `describe` 블록을 사용하여 관련 테스트를 묶고, `beforeEach`/`afterEach`를 사용하여 설정 및 정리를 수행하세요. 잘 조직된 테스트 스위트는 FluoBlog 애플리케이션이 수십 개의 서비스와 컨트롤러를 포함할 정도로 성장하더라도 탐색과 유지보수가 쉽습니다.

### 20.7.3 Avoiding "Mocks for Mocks"
애플리케이션을 과도하게 모의(mocking)하지 않도록 주의하세요. 의존성이 단순한 유틸리티나 순수 함수라면, 모의 객체를 만드는 대신 실제 구현을 사용하는 것이 나을 때가 많습니다. 과도한 모의는 유지보수가 어렵고 시스템의 실제 동작을 검증하지 못하는 취약한 테스트로 이어질 수 있습니다. Fluo에서 권장하는 규칙은 다음과 같습니다: 외부 의존성(데이터베이스, API, 서드파티 라이브러리)과 상태를 가진 서비스는 모의하되, 상태가 없는 로직과 내부 헬퍼는 실제 구현을 사용하세요.

### 20.7.4 Monitoring Test Performance
테스트 스위트가 커짐에 따라 개발 사이클이 느려질 수 있습니다. 테스트 실행 시간을 모니터링하고 최적화 대상이 될 수 있는 "느린 테스트"를 식별하세요. Vitest는 테스트 실행을 프로파일링하고 어떤 파일이나 스위트가 가장 많은 시간을 차지하는지 확인할 수 있는 내장 도구를 제공합니다. 테스트를 빠르고 효율적으로 유지하면 팀이 테스트를 자주 실행하기 쉽고, 전체 코드베이스에 걸쳐 품질 기준을 유지하기 좋습니다.

## 20.8 Advanced: Performance and Load Testing
기능 테스트도 중요하지만, 앱이 부하를 받았을 때 어떻게 동작하는지도 알아야 합니다. **Artillery**나 **k6**와 같은 도구를 사용하여 로컬 또는 스테이징 환경에 대해 부하 테스트를 실행하세요. 이때가 바로 처리량 제한(16장) 및 캐싱(17장) 전략이 실제로 예상대로 작동하는지 검증하는 시점입니다. Fluo의 고성능 특성은 여유 있는 출발점을 제공하지만, 모든 시스템에는 한계가 있으며 그 한계를 아는 것도 전문 엔지니어의 역할입니다.

### 20.8.1 Smoke Testing after Deployment
애플리케이션이 스테이징이나 프로덕션 환경에 배포된 후에는 **스모크 테스트(Smoke Tests)** 세트를 실행해야 합니다. 이는 "여전히 로그인할 수 있는가?", "메인 피드를 볼 수 있는가?"와 같은 가장 중요한 경로를 검증하는 고수준 통합 테스트입니다. 스모크 테스트는 배포 성공 여부에 대한 즉각적인 피드백을 제공하며, 모든 현대적인 CI/CD 파이프라인의 핵심 부분입니다. Fluo에서는 대상 URL을 라이브 환경으로 변경하기만 하면 기존의 많은 통합 테스트를 이 목적으로 재사용할 수 있습니다.

### 20.8.2 Continuous Integration (CI) and Testing
자동화된 테스트는 GitHub Actions나 GitLab CI와 같은 **지속적 통합(CI)** 시스템에 통합될 때 가장 효과적입니다. 저장소에 코드를 푸시할 때마다 테스트가 자동으로 실행되어야 합니다. 테스트가 하나라도 실패하면 빌드가 차단되어, 망가진 코드가 사용자에게 도달하는 것을 방지해야 합니다. Fluo의 빠른 시작과 효율적인 테스트 유틸리티는 CI 파이프라인을 짧게 유지하는 데 도움이 되며, 개발자에게 즉각적인 피드백을 제공하고 프로젝트 전체의 품질 기준을 지킵니다.

### 20.8.3 Testing for Accessibility and Performance
기능적 정확성을 넘어 **접근성(a11y)**과 **성능** 테스트도 고려해야 합니다. 이들은 흔히 "프론트엔드"의 관심사로 여겨지지만, 백엔드도 중요한 역할을 합니다. API가 스크린 리더를 위해 적절한 에러 메시지를 반환하고, 응답이 느린 모바일 네트워크에 맞게 관리되는지 확인하는 것은 품질 높은 애플리케이션을 구축하는 과정의 일부입니다. Lighthouse나 전문 접근성 린터를 사용하여 FluoBlog 백엔드가 사용자 경험에 어떤 영향을 주는지 확인하세요.

### 20.8.4 The Role of Chaos Engineering
미션 크리티컬한 애플리케이션이라면 **카오스 엔지니어링(Chaos Engineering)**을 고려해 보세요. 이는 시스템에 의도적으로 장애(예: 데이터베이스 인스턴스를 무작위로 종료하거나 네트워크 지연 주입)를 발생시켜 애플리케이션이 어떻게 대응하는지 확인하는 과정입니다. Fluo의 회복 탄력성 있는 설계와 내장된 헬스 체크(18장)는 이러한 시나리오를 처리하도록 설계되었지만, 카오스 테스트를 통해 복구 로직이 실제로 작동하는지 검증할 수 있습니다. 제어된 환경에서 장애를 주입하면 실제 사고 전에 복구 경로와 운영 절차를 점검할 수 있습니다.

## 20.9 Summary
`fluo`에서의 테스트는 명시적이고 표준 기반이며 추론하기 쉽다는 핵심 철학의 연장선상에 있습니다. 보이지 않는 동작을 줄이면 테스트 코드도 프로덕션 코드와 같은 구조를 따라갈 수 있습니다.

- 현대적인 개발자 경험과 빠른 실행을 위해 **Vitest**를 사용하세요.
- 순수 프로바이더 로직의 단위 테스트는 Vitest와 명시적 모의 객체로 작성하고, 모듈 그래프 통합 범위에는 `createTestingModule`을 사용하세요.
- 가드와 인터셉터를 포함한 실제 요청 파이프라인 검증에는 `createTestApp` 기반 E2E 스타일 HTTP 테스트를 사용하세요.
- 복잡한 설정 없이 보호된 경로를 테스트하기 위해 principal 모의(mocking)를 활용하세요.
- 일관되고 신뢰할 수 있는 테스트를 위해 "Mock -> Compile -> Resolve" 패턴을 따르세요.

탄탄한 테스트 스위트가 있다면, FluoBlog가 오늘 작동하고 내일도 계속 작동할지 배포 전에 검증할 수 있습니다. 마지막 장에서는 최종 관문인 프로덕션 배포를 준비합니다.
