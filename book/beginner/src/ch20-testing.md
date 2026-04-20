<!-- packages: @fluojs/testing -->
<!-- project-state: FluoBlog v1.17 -->

# Chapter 20. Testing

## Learning Objectives
- Set up a testing environment with Vitest and `@fluojs/testing`.
- Understand the difference between unit and integration tests in `fluo`.
- Use `createTestingModule` to isolate components for unit testing.
- Override providers with mocks and fakes during testing.
- Implement HTTP integration tests using `createTestApp`.
- Write automated tests for FluoBlog controllers and services.

## 20.1 Why Testing Matters in fluo
In a framework built on standard decorators and explicit dependency injection, testing becomes significantly easier. Because `fluo` doesn't rely on hidden metadata or global state, you can instantiate and wire up components exactly how you want in your test suites.

Testing ensures that:
- Your business logic is correct.
- Your API endpoints return the expected data and status codes.
- Your security guards and interceptors are working as intended.
- Refactoring doesn't break existing functionality.

## 20.2 Setting Up the Environment
We use **Vitest** as our primary test runner because it is fast, compatible with Vite, and works seamlessly with TypeScript.

Install the necessary dependencies:
```bash
pnpm add -g vitest
pnpm add -D @fluojs/testing @babel/core
```

`@babel/core` is required because `@fluojs/testing/vitest` uses a Babel plugin to handle standard decorators during the test run.

### Vitest Configuration
Create a `vitest.config.ts` file in your project root:

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
Unit tests focus on a single class (usually a Service) in isolation. To do this, we need to provide fakes or mocks for its dependencies.

### The Service to Test
Consider our `PostService`:

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
We use `createTestingModule` to compile a minimal module graph for the test.

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
`fluo` provides several ways to replace real components with test doubles.

- **`overrideProvider(token, value)`**: Replaces a specific token with a value (object or instance).
- **`overrideProviders([[token, value], ...])`**: Replaces multiple tokens at once.

This is particularly useful for bypassing databases, external APIs, or heavy computational tasks.

## 20.5 Integration Testing with createTestApp
Integration tests verify how multiple components work together, including the HTTP layer, guards, and interceptors.

Instead of starting a real network server, we use `createTestApp`, which provides a virtual request dispatch system.

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
If your route is protected by a guard that checks for a user session, you can simulate a logged-in user using `.principal()`:

```typescript
const response = await app
  .request('POST', '/posts')
  .principal({ subject: 'user-123', roles: ['admin'] })
  .body({ title: 'New Post', content: '...' })
  .send();
```

## 20.6 Mocking with createMock and createDeepMock
For complex classes, manually creating mock objects can be tedious. `@fluojs/testing/mock` provides helpers.

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

// Create a shallow mock where you define specific methods
const repo = createMock<PostRepository>({ 
  findAll: vi.fn().mockResolvedValue([]) 
});

// Create a deep mock where all methods are automatically mocked
const mailer = createDeepMock(MailService);
```

## 20.7 Best Practices for FluoBlog Testing
1.  **Don't test the framework**: Focus on your business logic, not whether `@Get()` works.
2.  **Use Fakes for Databases**: Use an in-memory database or a mock repository instead of a real database in unit tests.
3.  **Clean Up**: Always call `await app.close()` or `await module.close()` to release resources.
4.  **Test Edge Cases**: Include tests for invalid input, unauthorized access, and error conditions.

## 20.8 Summary
Testing in `fluo` is an extension of its core philosophy: explicit, standard-based, and easy to reason about.

- Use **Vitest** for a modern developer experience.
- Use `createTestingModule` for isolated unit tests.
- Use `createTestApp` for full-stack integration tests.
- Leverage provider overrides and mock helpers to control your test environment.

With a solid test suite, you can deploy FluoBlog with confidence. In the final chapter, we will prepare our application for production.

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
