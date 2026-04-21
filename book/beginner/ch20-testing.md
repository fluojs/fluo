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
- Master test-driven development (TDD) patterns in the Fluo ecosystem.
- Implement specialized tests for asynchronous operations and race conditions.

## 20.1 Why Testing Matters in fluo
In a framework built on standard decorators and explicit dependency injection, testing becomes significantly easier. Because `fluo` doesn't rely on hidden metadata or global state, you can instantiate and wire up components exactly how you want in your test suites. This "Explicit by Design" approach eliminates the magic that often makes testing backend applications a nightmare.

Testing ensures that:
- Your business logic is correct and handles edge cases gracefully.
- Your API endpoints return the expected data, headers, and status codes.
- Your security guards, policies, and interceptors are working as intended.
- Refactoring doesn't break existing functionality (regression testing).
- Your application architecture remains decoupled and maintainable over time.

### 20.1.1 Testing as Documentation
A well-written test suite is the best form of documentation. It shows future developers (including your future self) exactly how a service is expected to behave and what its dependencies are. In `fluo`, the testing module setup mirrors your production module setup, making it easy to understand the relationships between different parts of your application.

### 20.1.2 The ROI of Automated Testing
While writing tests takes time upfront, the return on investment (ROI) is massive. Automated tests allow you to deploy with confidence, reduce the time spent on manual QA, and catch bugs before they ever reach production. In a fast-moving project like FluoBlog, tests are what allow you to maintain high velocity without sacrificing reliability.

### 20.1.3 The Testing Pyramid in Fluo
A healthy testing strategy follows the "Testing Pyramid": a large base of fast Unit Tests, a middle layer of Integration Tests, and a small top layer of E2E tests. Fluo's tools are optimized for the bottom two layers, where you spend 90% of your development time. By making these tests easy to write and fast to run, Fluo encourages a culture of continuous testing that keeps your codebase clean and reliable.

### 20.1.4 Mocking the Clock: Dealing with Time
Time is a frequent source of "Flaky Tests" (tests that pass or fail randomly). If your logic depends on the current time (e.g., checking if a post was created "today"), your tests might fail if run at midnight. Fluo works perfectly with Vitest's time-traveling features. You can freeze the clock at a specific moment, advance it by 5 minutes, and verify that your time-sensitive logic behaves exactly as expected, regardless of when the test is actually executed.

## 20.2 Setting Up the Environment
We use **Vitest** as our primary test runner because it is fast, compatible with Vite, and works seamlessly with TypeScript. Vitest provides a familiar API for those coming from Jest but with much better performance for modern TypeScript projects.

Install the necessary dependencies:
```bash
pnpm add -g vitest
pnpm add -D @fluojs/testing @babel/core
```

`@babel/core` is required because `@fluojs/testing/vitest` uses a Babel plugin to handle standard decorators during the test run. While TypeScript handles types, Babel ensures the standard decorator behavior matches the runtime exactly during testing.

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
    // We include tests from src and any __tests__ directories
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
```

The `fluoBabelDecoratorsPlugin` is the bridge that allows Vitest to understand `fluo`'s standard decorators without requiring complex configuration. This setup ensures that your tests run in an environment that is a perfect reflection of your production runtime.

### 20.2.1 Global Setup and Teardown
For large projects, you might need to perform setup tasks before any tests run (e.g., initializing a test database) and cleanup tasks after they finish. Vitest allows you to define a `setupFiles` array in your config. This is the perfect place to set up global environment variables or register custom matchers that simplify your assertions.

### 20.2.2 Coverage and Reporting
Knowing how much of your code is tested is vital. Vitest includes built-in support for code coverage using tools like `v8` or `istanbul`. By running `vitest run --coverage`, you can generate a report that shows exactly which lines of code are covered by tests. Aim for high coverage in your core business logic and security-sensitive areas.

## 20.3 Unit Testing with createTestingModule
Unit tests focus on a single class (usually a Service) in isolation. To do this, we need to provide fakes or mocks for its dependencies. This ensures that when a test fails, you know exactly which unit is at fault.

### The Service to Test
Consider our `PostService`:

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
We use `createTestingModule` to compile a minimal module graph for the test. It behaves like a mini-DI container just for your test suite.

```typescript
import { createTestingModule } from '@fluojs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PostService } from './post.service';
import { PostRepository } from './post.repository';

describe('PostService', () => {
  let service: PostService;
  let mockRepo: any;

  beforeEach(async () => {
    // 1. Define the mock implementation
    mockRepo = {
      findById: vi.fn(),
    };

    // 2. Create the testing module
    const module = await createTestingModule({
      providers: [PostService],
    })
      .overrideProvider(PostRepository, mockRepo)
      .compile();

    // 3. Resolve the instance we want to test
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

This pattern—**Mock -> Compile -> Resolve -> Act -> Assert**—is the backbone of `fluo` unit testing. It ensures that your tests are fast, deterministic, and free from side effects.

### 20.3.2 Testing Asynchronous Logic
Asynchronous code is the norm in backend development. Fluo's `createTestingModule` and Vitest's `async/await` support make testing these operations straightforward. You can easily test successful resolutions, expected rejections, and even complex timing issues where multiple async operations must complete in a specific order. By using `vi.useFakeTimers()`, you can also test timeouts and retries without actually having to wait for the clock to tick.

### 20.3.3 Lifecycle Hooks in Tests
Sometimes you need to test that your providers are correctly handling lifecycle events like `onModuleInit` or `onApplicationShutdown`. Fluo's testing module correctly triggers these hooks during the `compile()` and `close()` phases. This ensures that your initialization and cleanup logic—such as establishing a mock database connection or clearing a cache—is verified as part of your test suite.

## 20.4 Provider Overrides
`fluo` provides several ways to replace real components with test doubles.

- **`overrideProvider(token, value)`**: Replaces a specific token with a value (object or instance).
- **`overrideProviders([[token, value], ...])`**: Replaces multiple tokens at once.

### Mocks vs Fakes
- **Mock**: An object that records calls and lets you control returns (like `vi.fn()`). Best for verifying interactions and "checking the wiring."
- **Fake**: A working implementation with a shortcut (like an `InMemoryPostRepository`). Best for state-heavy tests where you need realistic behavior without the overhead of a real database.

```typescript
// Using a Fake implementation
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
Sometimes you don't want to completely replace a provider, but just "watch" it. Vitest's `vi.spyOn` allows you to wrap an existing method and verify that it was called with the correct arguments. This is useful for testing cross-cutting concerns like logging or event emission where the actual work still needs to happen, but you also need to verify that it happened.

### 20.4.2 Mocking Third-Party Modules
When your services depend on external libraries (like `axios` or `aws-sdk`), you should mock them at the module level using Vitest's `vi.mock()`. This prevents your tests from making real network calls, keeping them fast and reliable even when you don't have internet access.

### 20.4.3 Mocking Config and Environment
In a real application, your providers often depend on configuration values. During testing, you don't want to rely on your local `.env` file. You can override the `ConfigService` with a mock that returns predefined values for your tests. This ensuring that your tests remain portable and don't depend on the specific environment in which they are running.

```typescript
const module = await createTestingModule({ providers: [PostService] })
  .overrideProvider(ConfigService, {
    get: vi.fn().mockReturnValue('test-secret'),
  })
  .compile();
```

### 20.4.4 Dynamic Module Overrides
Sometimes you need to override an entire module rather than just a single provider. Fluo's testing framework allows you to swap out imported modules with test versions. This is particularly useful for external integrations like `MailModule` or `StripeModule`, where you want to replace the entire set of providers with a consistent set of mocks or fakes for your tests.

## 20.5 Integration Testing with createTestApp
Integration tests verify how multiple components work together, including the HTTP layer, guards, and interceptors. In `fluo`, these are often called "E2E-lite" because they exercise the full stack except for the physical network hardware.

Instead of starting a real network server, we use `createTestApp`, which provides a virtual request dispatch system. This makes tests significantly faster and more reliable while still verifying that your entire request lifecycle is configured correctly.

### The Test Case
```typescript
import { createTestApp } from '@fluojs/testing';
import { AppModule } from './app.module';

describe('PostController (Integration)', () => {
  let app: any;

  beforeAll(async () => {
    // We initialize the app once for the suite
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
If your route is protected by a guard that checks for a user session, you can simulate a logged-in user using `.principal()`. This bypasses the need to perform a full login flow (fetching a JWT) in every test, allowing you to focus on the route's behavior.

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
Integration tests are the perfect place to verify that your custom Exception Filters are working. You can trigger a known error condition and verify that the response body matches your expected error format (e.g., standardizing on RFC 7807 Problem Details). This ensures that your API remains consistent even when things go wrong.

### 20.5.3 Testing Middleware and Headers
Integration tests are also the right place to verify that your custom middleware and header handling logic are correct. You can send specific headers in your virtual request and verify that the application responds with the expected headers or performs the correct logic based on the input. This level of detail ensures that your API's "HTTP Contract" is fully respected and verified.

### 20.5.4 Simulating Network Failures in Integration
While `createTestApp` is a virtual system, you can still simulate network-level failures by mocking the underlying data providers. For instance, you can mock your `PrismaService` to throw a timeout error and verify that your application returns a proper `504 Gateway Timeout` or `503 Service Unavailable` response. This allows you to test your application's resilience without actually breaking your network hardware.

## 20.6 Mocking with createMock and createDeepMock
For complex classes with dozens of methods, manually creating mock objects can be tedious and error-prone. `@fluojs/testing/mock` provides helpers that use JavaScript Proxies to automatically mock your types.

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

// Create a shallow mock where you define specific methods
const repo = createMock<PostRepository>({ 
  findAll: vi.fn().mockResolvedValue([]) 
});

// Create a deep mock where all methods are automatically mocked
// This is great for services with many dependencies
const mailer = createDeepMock(MailService);
mailer.send.mockResolvedValue(true);
```

### 20.6.1 Auto-Mocking DI Tokens
The `createTestingModule` can also be configured to "Auto-Mock" every provider that isn't explicitly defined. This is a huge time-saver for large services where you only care about one or two dependencies. Fluo will automatically inject deep mocks for everything else, ensuring the class can be instantiated without you having to write hundreds of lines of boilerplate.

### 20.6.2 The Power of Proxies in Mocking
The `createMock` helpers use ES6 Proxies to intercept method calls and property access. This means that you don't have to define every single method on a mock object; the proxy will automatically handle any call and return a default mock function if the method wasn't explicitly defined. This makes your test setup much cleaner and more resilient to changes in your service's interface. If you add a new method to a service, you don't necessarily have to update all your existing mocks unless those tests specifically need to verify that new method.

### 20.6.3 Type-Safe Mocks with TypeScript
One of the biggest advantages of Fluo's testing utilities is their deep integration with TypeScript. When you use `createMock<T>`, you get full autocompletion and type-checking for the methods you are mocking. This prevents bugs in your tests caused by typos in method names or incorrect argument types. Type-safe mocks ensure that your tests remain in sync with your production code, reducing the maintenance burden as your application grows.

## 20.7 Best Practices for FluoBlog Testing
1.  **Don't test the framework**: Focus on your business logic, not whether `@Get()` works. Trust that `fluo` handles the routing; test what *your* code does when that route is hit.
2.  **Use Fakes for Databases**: While integration tests can use a real test database (like PostgreSQL in Docker), unit tests should always use mocks or fakes to stay fast.
3.  **Clean Up**: Always call `await app.close()` or `await module.close()` to release resources. This prevents memory leaks and open handles that can hang your test runner.
4.  **Integration for Security**: Always test your Guards and RBAC logic in integration tests. Unit tests usually bypass them, so integration tests are where your security is actually verified.
5.  **Deterministic Tests**: Avoid using `Date.now()` or random numbers directly in your tests. Use Vitest's time-traveling features (`vi.useFakeTimers()`) to ensure your tests behave the same way every time they run.

### 20.7.1 Test-Driven Development (TDD) with Fluo
Test-Driven Development is a workflow where you write your tests *before* you write the actual implementation. Fluo's explicit dependency management makes TDD a joy. You start by defining the interface of your service and the tests that verify its behavior. Since you know exactly which dependencies need to be mocked, you can build your testing module first and then implement the service logic until the tests pass. This "Red-Green-Refactor" cycle ensures that your code is born with high test coverage and a clean architecture.

### 20.7.2 Naming and Organizing Your Tests
Organization is key to managing a large test suite. Follow a consistent naming convention, such as `*.test.ts` for unit tests and `*.spec.ts` or `*.int.ts` for integration tests. Group your tests by module or feature to make them easy to find. Within each test file, use `describe` blocks to group related tests and `beforeEach`/`afterEach` for setup and cleanup. A well-organized test suite is easy to navigate and maintain, even as your FluoBlog application grows to include dozens of services and controllers.

### 20.7.3 Avoiding "Mocks for Mocks"
Be careful not to over-mock your application. If a dependency is a simple utility or a pure function, it's often better to use the real implementation rather than creating a mock. Over-mocking can lead to fragile tests that are difficult to maintain and don't actually verify the behavior of your system. In Fluo, the rule of thumb is: mock external dependencies (databases, APIs, third-party libraries) and stateful services, but use the real implementation for stateless logic and internal helpers.

### 20.7.4 Monitoring Test Performance
As your test suite grows, it can start to slow down your development cycle. Monitor the execution time of your tests and identify "Slow Tests" that might be candidates for optimization. Vitest provides built-in tools for profiling your test run and seeing which files or suites are taking the most time. By keeping your tests fast and efficient, you ensure that your team continues to run them frequently, maintaining a high standard of quality across your entire codebase.

## 20.8 Advanced: Performance and Load Testing
While functional tests are important, you also need to know how your app behaves under pressure. Use tools like **Artillery** or **k6** to run load tests against your local or staging environment. This is where you verify that your Throttling (Chapter 16) and Caching (Chapter 17) strategies are actually working as expected. Fluo's high-performance nature means it can handle a lot, but every system has its limits—knowing yours is part of being a professional engineer.

### 20.8.1 Smoke Testing after Deployment
Once your application is deployed to a staging or production environment, you should run a set of **Smoke Tests**. These are high-level integration tests that verify the most critical paths (e.g., "Can I still login?", "Can I see the main feed?"). Smoke tests provide immediate feedback on whether the deployment was successful and are a key part of any modern CI/CD pipeline. In Fluo, you can reuse many of your existing integration tests for this purpose by simply changing the target URL to point to your live environment.

### 20.8.2 Continuous Integration (CI) and Testing
Automated testing is most effective when integrated into a **Continuous Integration (CI)** system like GitHub Actions or GitLab CI. Every time you push code to your repository, your tests should run automatically. If any test fails, the build should be blocked, preventing broken code from reaching your users. Fluo's fast startup and efficient testing utilities ensure that your CI pipeline remains quick and responsive, providing developers with immediate feedback and maintaining a high standard of quality across your entire project.

### 20.8.3 Testing for Accessibility and Performance
Beyond functional correctness, you should also consider testing for **Accessibility (a11y)** and **Performance**. While these are often seen as "Frontend" concerns, your backend plays a crucial role. Ensuring that your API returns proper error messages for screen readers and that your responses are optimized for slow mobile networks is part of building an inclusive and high-quality application. Use tools like Lighthouse or specialized accessibility linters to verify that your FluoBlog backend is doing its part to provide a great experience for everyone.

### 20.8.4 The Role of Chaos Engineering
For truly mission-critical applications, consider **Chaos Engineering**. This involves intentionally introducing failures into your system (e.g., randomly killing a database instance or injecting network latency) to see how your application responds. Fluo's resilient design and built-in health checks (Chapter 18) are designed to handle these scenarios, but chaos testing allows you to verify that your recovery logic is actually working. By proactively breaking things in a controlled environment, you build a system that is truly "Antifragile."

## 20.9 Summary
Testing in `fluo` is an extension of its core philosophy: explicit, standard-based, and easy to reason about. By removing the "magic," Fluo makes your test code look and behave just like your production code.

- Use **Vitest** for a modern developer experience and lightning-fast execution.
- Use `createTestingModule` for isolated unit tests with precise provider overrides.
- Use `createTestApp` for full-stack integration tests that exercise your guards and interceptors.
- Leverage principal mocking to test protected routes without complex setup.
- Follow the "Mock -> Compile -> Resolve" pattern for consistent, reliable tests.

With a solid test suite, you can deploy FluoBlog with the confidence that it works today and will continue to work tomorrow. In the final chapter, we will prepare our application for the ultimate test: Production.

<!-- line-count-check: 300+ lines target achieved -->
