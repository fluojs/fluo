# di and modules

<p><strong><kbd>English</kbd></strong> <a href="./di-and-modules.ko.md"><kbd>한국어</kbd></a></p>

Konekti manages application complexity through an **explicit, token-based Dependency Injection (DI) system** and a hierarchical **Module Graph**. Unlike frameworks that rely on "magic" reflection, Konekti requires clear contracts between every provider and its consumer.

## why this matters

In large-scale applications, "implicit" dependency injection—where the framework "guesses" what you need based on constructor types—is a recipe for disaster. It leads to:
- **Invisible coupling**: You don't realize how deep your dependency tree goes until it breaks.
- **Difficult testing**: Mocking becomes a chore when you're not 100% sure what's being injected.
- **Runtime surprises**: Circular dependencies or missing providers often result in cryptic `undefined` errors at runtime.

Konekti eliminates these pains by making the dependency graph **auditable and explicit**. You can look at any class and see exactly what it requires, where those requirements come from, and how they are scoped.

## core ideas

### token-based di
In Konekti, every dependency is identified by a **Token**. A token can be:
- **A Class**: The most common case. The class constructor itself acts as the unique identifier.
- **A Symbol or String**: Used for abstract interfaces (e.g., `ILogger`) where you want to swap implementations without changing the consumer.
- **A Configuration Key**: For injecting specific settings directly into a service.

By using explicit tokens, we bypass the need for `emitDecoratorMetadata` and ensure that your code is compatible with any modern JavaScript build tool.

### the module as a "boundary"
A **Module** in Konekti is more than just a organization tool; it is a **security and encapsulation boundary**.
- **Private by Default**: A service defined in `UserModule` is invisible to `AuthModule` unless it is explicitly listed in the `exports` array of `UserModule` and `UserModule` is in the `imports` of `AuthModule`.
- **Encapsulated Implementation**: This allows you to have internal "helper" services that cannot be accidentally used (and coupled to) by other parts of the system.

### constructor injection pattern
We mandate **Constructor Injection** as the primary pattern. This aligns with standard class-based programming and makes unit testing trivial: you simply pass mock objects to the constructor.

```ts
@Inject([UsersRepository, 'APP_CONFIG'])
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly config: any
  ) {}
}
```

## provider types

- **Class Providers**: Standard services instantiated by the framework.
- **Value Providers**: Injected constants, configurations, or external library instances.
- **Factory Providers**: Logic-driven providers that are created dynamically based on other services or environment state.
- **Alias Providers**: Mapping one token to another (e.g., mapping `ILogger` to `PinoLogger`).

## injection scopes

- **Singleton (Default)**: One instance shared across the whole app. Best for stateless services and connection pools.
- **Request**: A fresh instance per incoming HTTP request. Useful for storing request-specific state like the current user.
- **Transient**: A fresh instance for every single injection point.

## boundaries

- **No Global Scope**: There is no "global" provider unless explicitly marked. We prefer the safety of the import/export chain.
- **Circular Dependency Detection**: Konekti's DI container detects circular dependencies at bootstrap time and throws a clear error, preventing stack overflows.
- **Strict Validation**: If a required dependency is missing from the module graph, the application will **fail to start**. We prefer a crash at boot over a crash in production.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Decorators and Metadata](./decorators-and-metadata.md)
- [HTTP Runtime](./http-runtime.md)
- [DI Package README](../../packages/di/README.md)
