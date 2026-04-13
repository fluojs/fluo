# decorators and metadata

<p><strong><kbd>English</kbd></strong> <a href="./decorators-and-metadata.ko.md"><kbd>한국어</kbd></a></p>

fluo is built from the ground up on **TC39 Standard Decorators**. We have completely abandoned the legacy `experimentalDecorators` and `emitDecoratorMetadata` model in favor of a clean, performant, and standard-aligned metadata system.

## why this matters

For years, the TypeScript ecosystem relied on a "proposal" version of decorators that never became standard. This legacy system required the compiler to "guess" types and emit them as hidden metadata (`reflect-metadata`), leading to:
- **Hidden performance costs**: Large amounts of metadata emitted for every class, even if unused.
- **Fragile type-guessing**: Circular dependencies often broke the "metadata emit," leading to runtime `undefined` errors.
- **Lock-in**: Your code became dependent on specific TypeScript compiler flags, making it harder to run on tools like `esbuild`, `swc`, or native engines without complex plugins.

fluo's move to **Standard Decorators** ensures your backend is portable, explicit, and ready for the future of JavaScript.

## core ideas

### standard decorators (TC39)
Every decorator in fluo—`@Module`, `@Controller`, `@Inject`—is a standard JavaScript decorator. They are functions that receive a well-defined context and return a modified version of the element they decorate.
- **No Reflect Metadata**: We do not use `reflect-metadata`. Metadata is stored in a structured, framework-owned registry.
- **Native Speed**: Because we don't rely on heavy reflection libraries, application startup and dependency resolution are significantly faster.

### explicit over implicit
Legacy frameworks often "guessed" your dependencies by looking at constructor types. In fluo, we value **explicitness**.
- You use `@Inject(UsersService)` to clearly state your dependencies.
- This makes your code searchable, auditable, and eliminates the "magic" that leads to difficult-to-debug DI issues.

### framework-owned registry
Decorators in fluo serve as "declarations" that populate a central **Framework Registry**. This registry acts as the source of truth for:
1. **The Dependency Graph**: Which classes depend on which tokens.
2. **Routing Tables**: Which methods handle which HTTP paths.
3. **Validation Schemas**: How incoming JSON should be parsed and checked.

For HTTP routing, that registry uses a deliberately small path contract: each route segment is either a literal string or a full-segment `:param` placeholder. Wildcards, regex-like syntax, and mixed segments such as `user-:id` are intentionally excluded from route decorators so the same handler mapping works consistently across runtimes. Middleware route filters keep their own `forRoutes('/prefix/*')` wildcard support and should not be confused with controller route syntax.

## decorator families

- **Structural (`@Module`)**: Defines the boundaries of a feature and its exported providers.
- **Component (`@Controller`, `@Service`)**: Marks a class as a participant in the framework's lifecycle.
- **Dependency (`@Inject`, `@Optional`)**: Explicitly declares the contract between a class and its dependencies.
- **Behavioral (`@Get`, `@Post`, `@UseMiddleware`)**: Attaches runtime logic to specific methods or classes.

## boundaries

- **No Magic Discovery**: fluo does not "scan" your filesystem. Metadata is registered only when a class is imported and its decorators are executed.
- **Immutable at Runtime**: Once the application is bootstrapped, the framework registry is typically locked. You cannot dynamically add decorators to a running class.
- **Type Safety First**: While decorators add metadata, they do not change the type signature of your classes. Your IDE and compiler still see the original, clean TypeScript class.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [DI and Modules](./di-and-modules.md)
- [HTTP Runtime](./http-runtime.md)
- [Core README](../../packages/core/README.md)
