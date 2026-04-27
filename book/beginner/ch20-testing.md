<!-- packages: @fluojs/testing -->
<!-- project-state: FluoBlog v1.17 -->

# Chapter 20. Testing

This chapter explains how to verify FluoBlog's services and HTTP flow with automated tests. Chapter 19 covered how to observe runtime state in production. This chapter builds a safety net that verifies behavior repeatably before deployment.

## Learning Objectives
- Set up a testing environment with Vitest and `@fluojs/testing`.
- Understand the differences between unit tests, integration tests, and E2E-style HTTP tests in `fluo`.
- Learn how to use `createTestingModule` to build integration tests around Module Graph compilation and Provider overrides.
- Replace Providers with mocks or fakes during tests.
- Implement HTTP tests that verify the real request pipeline with `createTestApp`.
- Write automated tests for FluoBlog Controllers and services.

## Prerequisites
- Completion of Chapter 5 and Chapter 13.
- Completion of Chapter 15 through Chapter 19.
- Basic understanding of TypeScript asynchronous code and test runner usage.

## 20.1 Why Testing Matters in fluo
In `fluo`, a framework built on standard Decorators and explicit Dependency Injection (DI), test setup is relatively direct. Because `fluo` does not depend on hidden metadata or global state, you can instantiate and wire the components you need in a test suite. This "Explicit by Design" approach reduces the invisible coupling that often makes backend applications hard to test.

Tests make sure that:
- Business logic works correctly and handles edge cases predictably.
- API endpoints return the expected data, headers, and status codes.
- Security Guards, policies, and Interceptors work as intended.
- Refactoring does not break existing behavior, which is regression testing.
- The application architecture stays loosely coupled and maintainable over time.

### 20.1.1 Testing as Documentation
A well-written test suite acts as behavior documentation. It shows future developers, including your future self, exactly how a service should behave and what it depends on. In `fluo`, testing module setup mirrors production Module setup, so the relationships between different parts of the application are visible in code as well.

### 20.1.2 The ROI of Automated Testing
Writing tests takes time upfront, but the return on investment, ROI, is high. Automated tests give you a signal before deployment, reduce time spent on manual QA, and catch bugs before they reach production. In a fast-moving project like FluoBlog, tests are a key mechanism for preserving both development speed and stability.

### 20.1.3 The Testing Pyramid in Fluo
A healthy testing strategy follows the "testing pyramid." That means many fast unit tests at the base, a middle layer of integration tests, and a small number of E2E tests at the top. Fluo's tooling is aimed at the lower two layers, where most development time is spent. When these tests are easy to write and fast to run, a testing culture emerges that keeps the codebase clean and reliable.

### 20.1.4 Mocking the Clock: Dealing with Time
Time is a frequent cause of flaky tests, tests that pass or fail randomly. If logic depends on the current time, for example, checking whether a post was created "today," it might fail when the test runs at midnight. Fluo works with Vitest's time manipulation features. You can freeze time at a specific moment or advance it by five minutes, then verify that time-sensitive logic behaves as expected no matter when the test actually runs.

## 20.2 Setting Up the Environment
This chapter uses **Vitest** as the default test runner because it is fast, compatible with Vite, and works well with TypeScript. Vitest provides an API that feels familiar to Jest users while delivering strong runtime performance in modern TypeScript projects.

Install the required dependencies:
```bash
pnpm add -g vitest
pnpm add -D @fluojs/testing @babel/core
```

`@babel/core` is required because `@fluojs/testing/vitest` uses a Babel plugin to process standard Decorators during test execution. TypeScript handles types, while Babel makes sure tests use the same standard Decorator behavior as the runtime.

### Vitest Configuration
Create a `vitest.config.ts` file at the project root:

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
    // Include tests inside src and every __tests__ directory.
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
```

`fluoBabelDecoratorsPlugin` acts as a bridge that lets Vitest understand `fluo` standard Decorators without complex configuration. This setup aligns the test environment with how the actual production runtime processes Decorators.

### 20.2.1 Global Setup and Teardown
Large projects may need work that runs before all tests, such as initializing a test database, and cleanup work after tests finish. Vitest lets you define a `setupFiles` array in the configuration. This is a good place to set global environment variables or register custom matchers that simplify assertions.

### 20.2.2 Coverage and Reporting
It is useful to know how much of your code is tested. Vitest has built-in code coverage support through tools such as `v8` or `istanbul`. Running `vitest run --coverage` generates a report that shows which lines of code were exercised by tests. Aim for high coverage in core business logic and security-sensitive areas.

## 20.3 Integration Testing with createTestingModule
`createTestingModule` is an integration test surface that compiles the real Module Graph inside one application slice and verifies DI wiring while overriding only the Providers you need. You can inject test doubles to control specific dependencies, but this category is not a pure unit test. It belongs to Module Graph-level integration scope.

### The Service to Test
Consider `PostService`:

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
Use `createTestingModule` to compile the smallest Module Graph needed for the test. It works like a mini DI container only for tests.

```typescript
import { createTestingModule } from '@fluojs/testing';
import { Module } from '@fluojs/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PostService } from './post.service';
import { PostRepository } from './post.repository';

describe('PostService', () => {
  let service: PostService;
  let mockRepo: any;

  beforeEach(async () => {
    // 1. Define the mock implementation.
    mockRepo = {
      findById: vi.fn(),
    };

    // 2. Create the testing module.
    @Module({
      providers: [PostRepository, PostService],
    })
    class PostTestModule {}

    const module = await createTestingModule({
      rootModule: PostTestModule,
    })
      .overrideProvider(PostRepository, mockRepo)
      .compile();

    // 3. Resolve the instance under test.
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

This pattern, **Mock -> Compile -> Resolve -> Act -> Assert**, is the core of `createTestingModule`-based integration tests. It lets you control only the dependencies you need while preserving the real Module Graph and DI resolution, so tests stay deterministic while also verifying the wiring of the current application slice.

### 20.3.2 Testing Asynchronous Logic
Asynchronous code is common in backend development. Fluo's `createTestingModule` and Vitest's `async/await` support let you test these operations in order. You can verify successful completion, expected rejections, and timing issues where several asynchronous operations must complete in a specific sequence. With `vi.useFakeTimers()`, you can test timeout or retry logic without actually waiting for time to pass.

### 20.3.3 Lifecycle Hooks in Tests
Sometimes you need to test whether Providers handle lifecycle events such as `onModuleInit` or `onApplicationShutdown` correctly. Fluo's testing module triggers these hooks during the `compile()` and `close()` phases. This lets you verify initialization and cleanup logic, such as opening a mock database connection or clearing a cache, as part of the test suite.

## 20.4 Provider Overrides
`fluo` provides several ways to replace real components with test doubles. This lets you remove instability from external systems while still verifying the DI wiring and execution flow of the Module you care about.

- **`overrideProvider(token, value)`**: Replaces a specific Token with a value, object, or instance.
- **`overrideProviders([[token, value], ...])`**: Replaces several Tokens at once.

### Mocks vs Fakes
- **Mock**: An object that records calls and lets you control return values, for example, `vi.fn()`. It is useful for verifying interactions and "checking the wiring."
- **Fake**: A real working implementation built with a shortcut, for example, `InMemoryPostRepository`. It is useful for state-centered tests without a real database.

```typescript
// Example using a fake implementation.
class FakePostRepository {
  private data = new Map();
  async findById(id: string) { return this.data.get(id); }
  async save(post: any) { this.data.set(post.id, post); }
}

@Module({ providers: [PostRepository, PostService] })
class PostTestModule {}

const module = await createTestingModule({ rootModule: PostTestModule })
  .overrideProvider(PostRepository, new FakePostRepository())
  .compile();
```

### 20.4.1 Spies and Verification
Sometimes you do not want to replace a Provider completely. You only want to observe it. Vitest's `vi.spyOn` wraps an existing method so you can check whether it was called with the right arguments. This is useful for testing cross-cutting concerns such as logging or event publication, where the real work should still happen but you also need to verify that a call occurred.

### 20.4.2 Mocking Third-Party Modules
If a service depends on an external library, such as `axios` or `aws-sdk`, use Vitest's `vi.mock()` to mock it at the module level. This prevents tests from making real network requests, so they run quickly and reliably without an internet connection.

### 20.4.3 Mocking Config and Environment
In real applications, Providers often depend on configuration values. During tests, it is safer not to depend on a local `.env` file. You can replace `ConfigService` with a mock that returns predefined values for tests. This keeps tests portable and independent of the specific environment where they run.

```typescript
@Module({ providers: [ConfigService, PostService] })
class PostTestModule {}

const module = await createTestingModule({ rootModule: PostTestModule })
  .overrideProvider(ConfigService, {
    get: vi.fn().mockReturnValue('test-secret'),
  })
  .compile();
```

### 20.4.4 Dynamic Module Overrides
Sometimes you need to replace an entire Module, not just a single Provider. Fluo's testing framework lets you replace imported Modules with test versions. This is especially useful when testing external integration Modules such as `MailModule` or `StripeModule`, where you want to replace the whole Provider set with a consistent set of mocks or fakes for tests.

## 20.5 E2E-Style HTTP Testing with createTestApp
`createTestApp` is an E2E-style HTTP test surface that runs the real HTTP pipeline, including request dispatch, Guards, Interceptors, DTO validation, and response writing. It does not open a real network socket, but it verifies the request handling stack itself in the same way as the production path.

Instead of starting a real network server, use `createTestApp`, which provides a virtual request dispatch system. This improves test speed and reliability while still checking that the full request lifecycle is configured correctly.

### The Test Case
```typescript
import { createTestApp } from '@fluojs/testing';
import { AppModule } from './app.module';

describe('PostController (E2E-style HTTP)', () => {
  let app: any;

  beforeAll(async () => {
    // Initialize the app once for the test suite.
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
When a route is protected by a Guard that checks the user session, you can use `.principal()` to simulate a signed-in user. This lets you focus on the route behavior itself without running the full login flow, such as obtaining a JWT, in every test.

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
Integration tests are a good place to check whether a custom Exception Filter works correctly. You can trigger a known error condition and verify that the response body matches the expected error format, such as the RFC 7807 Problem Details standard. This helps keep the API consistent even when something goes wrong.

### 20.5.3 Testing Middleware and Headers
Integration tests are a good place to verify custom Middleware and header handling logic. You can send a virtual request with specific headers, then check whether the application responds with the expected headers or performs the right logic based on the input. These detailed checks confirm that the API's "HTTP Contract" is being honored.

### 20.5.4 Simulating Network Failures in Integration
Although `createTestApp` is a virtual system, you can still simulate network-level failures by mocking the underlying data Provider. For example, you can mock `PrismaService` to throw a timeout error and verify that the application returns the proper `504 Gateway Timeout` or `503 Service Unavailable` response. This lets you test application resilience without physically breaking network hardware.

## 20.6 Mocking with createMock and createDeepMock
For complex classes, manually mocking dozens of methods is tedious and error-prone. `@fluojs/testing/mock` provides helpers that use JavaScript Proxy to automatically mock types. This keeps test setup short and lets you spend more attention on the behavior you actually want to verify.

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

// Create a shallow mock that defines only specific methods.
const repo = createMock<PostRepository>({ 
  findAll: vi.fn().mockResolvedValue([]) 
});

// Create a deep mock where every method is mocked automatically.
// Useful when testing services with many dependencies.
const mailer = createDeepMock(MailService);
mailer.send.mockResolvedValue(true);
```

### 20.6.1 Auto-Mocking DI Tokens
`createTestingModule` can also be configured to auto-mock every Provider that is not explicitly defined. This saves time when testing a large service where only one or two dependencies matter. Fluo automatically injects deep mocks for every other dependency, allowing the class to be instantiated without much boilerplate.

### 20.6.2 The Power of Proxies in Mocking
The `createMock` helper uses an ES6 Proxy to intercept method calls and property access. This means you do not need to define every method on the mock manually. The proxy handles every call automatically and returns a default mock function when a method is not explicitly defined. This makes test setup simpler and easier to adapt when service interfaces change. If you add a new method to a service, you do not need to update every existing mock unless a test specifically verifies that method.

### 20.6.3 Type-Safe Mocks with TypeScript
One of the biggest advantages of Fluo's testing utilities is their deep integration with TypeScript. With `createMock<T>`, you get full autocomplete and type checking for the methods you are mocking. This prevents test bugs caused by typos in method names or incorrect argument types. Type-safe mocks help test code stay synchronized with production code and reduce maintenance cost as the application grows.

## 20.7 Best Practices for FluoBlog Testing
1.  **Do not test the framework**: Focus on your application's business logic, not whether `@Get()` works. Assume `fluo` handles routing and test what your code does when that route is called.
2.  **Use fakes for databases**: Integration tests can use a real test database, such as PostgreSQL in Docker, but unit tests should always use mocks or fakes for speed.
3.  **Clean up resources**: Always call `await app.close()` or `await module.close()` to release resources. This prevents memory leaks and test runners that never exit.
4.  **Integration tests for security**: Always test Guards and RBAC logic in integration tests. Unit tests usually bypass them, so integration tests are where real security gets verified.
5.  **Deterministic tests**: Avoid using `Date.now()` or random numbers directly in tests. Use Vitest's time travel features, `vi.useFakeTimers()`, to make sure tests behave the same way every time they run.

### 20.7.1 Test-Driven Development (TDD) with Fluo
Test-driven development, TDD, is a workflow where you write tests *before* writing the actual implementation. Fluo's explicit dependency management provides a good structure for TDD. Start by defining tests that verify a service's interface and behavior. Since you know exactly which dependencies need to be mocked, you can build the testing module first and then implement the service logic until the tests pass. This "Red-Green-Refactor" cycle helps code evolve with test coverage and a clear architecture.

### 20.7.2 Naming and Organizing Your Tests
Organization is key to managing a large test suite. Follow a consistent naming convention, such as `*.test.ts` for unit tests and `*.spec.ts` or `*.int.ts` for integration tests. Group tests by Module or feature so they are easy to find. Inside each test file, use `describe` blocks to group related tests, and use `beforeEach`/`afterEach` for setup and cleanup. A well-organized test suite stays easy to navigate and maintain even as the FluoBlog application grows to include dozens of services and Controllers.

### 20.7.3 Avoiding "Mocks for Mocks"
Be careful not to over-mock your application. If a dependency is a simple utility or pure function, it is often better to use the real implementation instead of creating a mock. Excessive mocking can lead to brittle tests that are hard to maintain and do not verify the system's real behavior. The recommended rule in Fluo is: mock external dependencies, such as databases, APIs, and third-party libraries, and stateful services, but use the real implementation for stateless logic and internal helpers.

### 20.7.4 Monitoring Test Performance
As your test suite grows, your development cycle can slow down. Monitor test execution time and identify "slow tests" that may need optimization. Vitest provides built-in tools for profiling test runs and seeing which files or suites take the most time. Keeping tests fast and efficient makes it easier for the team to run them often and maintain quality standards across the whole codebase.

## 20.8 Advanced: Performance and Load Testing
Functional tests are important, but you also need to know how your app behaves under load. Use tools such as **Artillery** or **k6** to run load tests against local or staging environments. This is where you verify that your throughput limiting from Chapter 16 and caching strategy from Chapter 17 actually work as expected. Fluo's high-performance nature gives you a strong starting point, but every system has limits, and knowing those limits is part of professional engineering.

### 20.8.1 Smoke Testing after Deployment
After an application is deployed to staging or production, you should run a set of **Smoke Tests**. These are high-level integration tests that verify the most important paths, such as "can users still log in?" and "can users view the main feed?" Smoke tests provide immediate feedback about deployment success and are a core part of every modern CI/CD pipeline. In Fluo, you can reuse many existing integration tests for this purpose by changing only the target URL to a live environment.

### 20.8.2 Continuous Integration (CI) and Testing
Automated tests are most effective when integrated into a **Continuous Integration (CI)** system such as GitHub Actions or GitLab CI. Tests should run automatically every time code is pushed to the repository. If even one test fails, the build should be blocked so broken code cannot reach users. Fluo's fast startup and efficient testing utilities help keep CI pipelines short, giving developers immediate feedback and preserving quality standards across the project.

### 20.8.3 Testing for Accessibility and Performance
Beyond functional correctness, you should also consider **accessibility (a11y)** and **performance** testing. These are often treated as "frontend" concerns, but the backend also plays an important role. Making sure the API returns appropriate error messages for screen readers and that responses are managed for slow mobile networks is part of building a high-quality application. Use Lighthouse or specialized accessibility linters to see how the FluoBlog backend affects the user experience.

### 20.8.4 The Role of Chaos Engineering
For mission-critical applications, consider **Chaos Engineering**. This is the practice of intentionally introducing failures into a system, such as randomly shutting down a database instance or injecting network latency, to see how the application responds. Fluo's resilient design and built-in health checks from Chapter 18 are designed to handle these scenarios, but chaos testing can verify that recovery logic actually works. Injecting failures in a controlled environment lets you check recovery paths and operating procedures before a real incident occurs.

## 20.9 Summary
Testing in `fluo` is an extension of its core philosophy: explicit, standards-based, and easy to reason about. When invisible behavior is reduced, test code can follow the same structure as production code.

- Use **Vitest** for a modern developer experience and fast execution.
- Write unit tests for pure Provider logic with Vitest and explicit mocks, and use `createTestingModule` for Module Graph integration scope.
- Use `createTestApp`-based E2E-style HTTP tests to verify the real request pipeline, including Guards and Interceptors.
- Use principal mocking to test protected routes without complex setup.
- Follow the "Mock -> Compile -> Resolve" pattern for consistent, reliable tests.

With a solid test suite, you can verify before deployment that FluoBlog works today and will keep working tomorrow. In the final chapter, we prepare for the last gate: production deployment.
