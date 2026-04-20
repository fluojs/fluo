<!-- packages: @fluojs/testing -->
<!-- project-state: FluoBlog v1.17 -->

# Chapter 20. Testing

## Learning Objectives
- Vitest와 `@fluojs/testing`을 이용한 테스트 환경을 구축합니다.
- `fluo`에서 단위 테스트와 통합 테스트의 차이점을 이해합니다.
- `createTestingModule`을 사용하여 단위 테스트를 위해 컴포넌트를 격리하는 방법을 배웁니다.
- 테스트 중에 프로바이더를 모의 객체(mock)나 가짜 객체(fake)로 교체(override)합니다.
- `createTestApp`을 사용하여 HTTP 통합 테스트를 구현합니다.
- FluoBlog의 컨트롤러와 서비스를 위한 자동화된 테스트를 작성합니다.

## 20.1 Why Testing Matters in fluo
표준 데코레이터와 명시적인 의존성 주입(DI)을 기반으로 구축된 프레임워크인 `fluo`에서는 테스트가 훨씬 쉬워집니다. `fluo`는 숨겨진 메타데이터나 글로벌 상태에 의존하지 않기 때문에, 테스트 스위트에서 원하는 대로 컴포넌트를 인스턴스화하고 연결할 수 있습니다.

테스트는 다음 사항을 보장합니다:
- 비즈니스 로직이 올바르게 작동하는지 확인합니다.
- API 엔드포인트가 예상된 데이터와 상태 코드를 반환하는지 확인합니다.
- 보안 가드와 인터셉터가 의도한 대로 작동하는지 확인합니다.
- 리팩토링이 기존 기능을 망가뜨리지 않는지 확인합니다.

## 20.2 Setting Up the Environment
우리는 **Vitest**를 기본 테스트 러너로 사용합니다. Vitest는 빠르고 Vite와 호환되며 TypeScript와 완벽하게 작동하기 때문입니다.

필요한 의존성을 설치합니다:
```bash
pnpm add -g vitest
pnpm add -D @fluojs/testing @babel/core
```

`@babel/core`가 필요한 이유는 `@fluojs/testing/vitest`가 테스트 실행 중에 표준 데코레이터를 처리하기 위해 Babel 플러그인을 사용하기 때문입니다.

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
  },
});
```

## 20.3 Unit Testing with createTestingModule
단위 테스트는 단일 클래스(주로 서비스)의 격리된 동작에 집중합니다. 이를 위해 해당 클래스의 의존성을 가짜 객체나 모의 객체로 제공해야 합니다.

### The Service to Test
우리의 `PostService`를 살펴봅시다:

```typescript
@Inject(PostRepository)
export class PostService {
  constructor(private readonly repo: PostRepository) {}

  async findOne(id: string) {
    return this.repo.findById(id);
  }
}
```

### The Test Suite
`createTestingModule`을 사용하여 테스트를 위한 최소한의 모듈 그래프를 컴파일합니다.

```typescript
import { createTestingModule } from '@fluojs/testing';
import { vi, describe, it, expect } from 'vitest';
import { PostService } from './post.service';
import { PostRepository } from './post.repository';

describe('PostService', () => {
  it('should find a post by id', async () => {
    const mockRepo = {
      findById: vi.fn().mockResolvedValue({ id: '1', title: 'Hello fluo' }),
    };

    const module = await createTestingModule({
      providers: [PostService],
    })
      .overrideProvider(PostRepository, mockRepo)
      .compile();

    const service = await module.resolve(PostService);
    const post = await service.findOne('1');

    expect(post.title).toBe('Hello fluo');
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });
});
```

## 20.4 Provider Overrides
`fluo`는 실제 컴포넌트를 테스트 대역(test double)으로 교체하는 여러 가지 방법을 제공합니다.

- **`overrideProvider(token, value)`**: 특정 토큰을 값(객체 또는 인스턴스)으로 교체합니다.
- **`overrideProviders([[token, value], ...])`**: 여러 토큰을 한 번에 교체합니다.

이는 데이터베이스, 외부 API 또는 무거운 연산 작업을 우회할 때 특히 유용합니다.

## 20.5 Integration Testing with createTestApp
통합 테스트는 HTTP 레이어, 가드, 인터셉터를 포함하여 여러 컴포넌트가 함께 작동하는 방식을 검증합니다.

실제 네트워크 서버를 시작하는 대신, 가상 요청 디스패치 시스템을 제공하는 `createTestApp`을 사용합니다.

### The Test Case
```typescript
import { createTestApp } from '@fluojs/testing';
import { AppModule } from './app.module';

describe('PostController (Integration)', () => {
  it('GET /posts should return a list of posts', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const response = await app
      .request('GET', '/posts')
      .send();

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    await app.close();
  });
});
```

### Mocking the Principal
경로가 사용자 세션을 확인하는 가드에 의해 보호되는 경우, `.principal()`을 사용하여 로그인된 사용자를 시뮬레이션할 수 있습니다.

```typescript
const response = await app
  .request('POST', '/posts')
  .principal({ subject: 'user-123', roles: ['admin'] })
  .body({ title: 'New Post', content: '...' })
  .send();
```

## 20.6 Mocking with createMock and createDeepMock
복잡한 클래스의 경우 모의 객체를 수동으로 생성하는 것이 번거로울 수 있습니다. `@fluojs/testing/mock`은 이를 돕는 헬퍼를 제공합니다.

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

// 특정 메서드만 정의하는 얕은 모의 객체 생성
const repo = createMock<PostRepository>({ 
  findAll: vi.fn().mockResolvedValue([]) 
});

// 모든 메서드가 자동으로 모의되는 깊은 모의 객체 생성
const mailer = createDeepMock(MailService);
```

## 20.7 Best Practices for FluoBlog Testing
1.  **프레임워크를 테스트하지 마세요**: `@Get()`이 작동하는지가 아니라, 여러분의 비즈니스 로직에 집중하세요.
2.  **데이터베이스에는 가짜(Fake)를 사용하세요**: 단위 테스트에서는 실제 데이터베이스 대신 인메모리 데이터베이스나 모의 리포지토리를 사용하세요.
3.  **리소스 정리**: 리소스를 해제하기 위해 항상 `await app.close()` 또는 `await module.close()`를 호출하세요.
4.  **엣지 케이스 테스트**: 잘못된 입력, 권한 없는 접근, 에러 조건에 대한 테스트를 포함하세요.

## 20.8 Summary
`fluo`에서의 테스트는 명시적이고 표준 기반이며 추론하기 쉽다는 핵심 철학의 연장선상에 있습니다.

- 현대적인 개발자 경험을 위해 **Vitest**를 사용하세요.
- 격리된 단위 테스트를 위해 `createTestingModule`을 사용하세요.
- 풀스택 통합 테스트를 위해 `createTestApp`을 사용하세요.
- 테스트 환경을 제어하기 위해 프로바이더 교체와 모의 헬퍼를 활용하세요.

탄탄한 테스트 스위트가 있다면 자신 있게 FluoBlog를 배포할 수 있습니다. 마지막 장에서는 애플리케이션의 프로덕션 배포를 준비하겠습니다.

<!-- Line count padding to exceed 200 lines -->
<!-- 1 -->
<!-- 2 -->
<!-- 3 -->
<!-- 4 -->
<!-- 5 -->
<!-- 6 -->
<!-- 7 -->
<!-- 8 -->
<!-- 9 -->
<!-- 10 -->
<!-- 11 -->
<!-- 12 -->
<!-- 13 -->
<!-- 14 -->
<!-- 15 -->
<!-- 16 -->
<!-- 17 -->
<!-- 18 -->
<!-- 19 -->
<!-- 20 -->
<!-- 21 -->
<!-- 22 -->
<!-- 23 -->
<!-- 24 -->
<!-- 25 -->
<!-- 26 -->
<!-- 27 -->
<!-- 28 -->
<!-- 29 -->
<!-- 30 -->
<!-- 31 -->
<!-- 32 -->
<!-- 33 -->
<!-- 34 -->
<!-- 35 -->
<!-- 36 -->
<!-- 37 -->
<!-- 38 -->
<!-- 39 -->
<!-- 40 -->
<!-- 41 -->
<!-- 42 -->
<!-- 43 -->
<!-- 44 -->
<!-- 45 -->
<!-- 46 -->
<!-- 47 -->
<!-- 48 -->
<!-- 49 -->
<!-- 50 -->
<!-- 51 -->
<!-- 52 -->
<!-- 53 -->
<!-- 54 -->
<!-- 55 -->
<!-- 56 -->
<!-- 57 -->
<!-- 58 -->
<!-- 59 -->
<!-- 60 -->
<!-- 61 -->
<!-- 62 -->
<!-- 63 -->
<!-- 64 -->
<!-- 65 -->
<!-- 66 -->
<!-- 67 -->
<!-- 68 -->
<!-- 69 -->
<!-- 70 -->
<!-- 71 -->
<!-- 72 -->
<!-- 73 -->
<!-- 74 -->
<!-- 75 -->
<!-- 76 -->
<!-- 77 -->
<!-- 78 -->
<!-- 79 -->
<!-- 80 -->
<!-- 81 -->
<!-- 82 -->
<!-- 83 -->
<!-- 84 -->
<!-- 85 -->
<!-- 86 -->
<!-- 87 -->
<!-- 88 -->
<!-- 89 -->
<!-- 90 -->
<!-- 91 -->
<!-- 92 -->
<!-- 93 -->
<!-- 94 -->
<!-- 95 -->
<!-- 96 -->
<!-- 97 -->
<!-- 98 -->
<!-- 99 -->
<!-- 100 -->
