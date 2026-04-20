<!-- packages: @fluojs/core, @fluojs/di, @fluojs/runtime -->
<!-- project-state: advanced -->
# Chapter 16. Creating Custom Packages

In the final part of our advanced journey, we move beyond being consumers of fluo and step into the role of ecosystem contributors. fluo is designed as a collection of precision-engineered modules, and its architecture is intentionally "open for extension." Whether you are building an internal library for your organization or a public plugin for the community, understanding how to structure and design a fluo-compatible package is essential.

This chapter dissects the internal package structure of the fluo monorepo, explores the design patterns of `DynamicModule`, and demonstrates how to build a robust, standard-first package using a feature-flags mini-package as a practical example.

## Monorepo Package Structure

The fluo monorepo follows a strict organizational pattern that ensures high cohesion and low coupling. Every official package follows a predictable layout that you should emulate for your custom packages.

### Public Surface and Internal Seams

In fluo, visibility is a first-class citizen. A package typically exposes its functionality through a specific set of entry points defined in `package.json` under the `exports` field.

```json
{
  "name": "@fluojs/my-package",
  "exports": {
    ".": "./dist/index.js",
    "./internal": "./dist/internal/index.js"
  }
}
```

1. **`index.ts` (The Public Root)**: This file should contain only re-exports of public APIs, decorators, and types. It is the "front door" of your package.
2. **`module.ts`**: We often isolate the `Module` definition here. This allows consumers to import the logic without necessarily bringing in the framework-specific metadata if they only need types or utilities.
3. **`internal/`**: This directory contains implementation details that are not part of the public contract. By separating these, you signal to users that these APIs are subject to change without semver warnings.

### Dependency Declaration

fluo packages generally depend on three core pillars:
- `@fluojs/core`: Provides the metadata spine (`@Module`, `@Global`, `@Inject`).
- `@fluojs/di`: Provides the token-based container and provider models.
- `@fluojs/runtime`: Needed only if your package performs manual bootstrapping or graph manipulation.

When building a library, always prefer depending on `@fluojs/core` and `@fluojs/di` as `peerDependencies` to avoid version conflicts in the user's dependency graph.

## Designing DynamicModules

The `DynamicModule` pattern is the primary way to provide configurable functionality in fluo. Unlike static modules that are defined at compile-time, dynamic modules are generated at runtime, often accepting a configuration object.

### The DynamicModule Contract

A `DynamicModule` is an object (or a class with a static method returning an object) that satisfies the `ModuleMetadata` interface plus a `module` reference.

```ts
export interface DynamicModule extends ModuleMetadata {
  module: Type<any>;
}
```

Components of a dynamic module:
- `imports`: Other modules required by this dynamic instance.
- `providers`: Custom providers, often including the configuration object.
- `exports`: Which providers should be visible to importing modules.
- `global`: Boolean flag to make the module globally visible.

### The forRoot and forRootAsync Pattern

Following the community standard, fluo libraries use `forRoot` for static configuration and `forRootAsync` for configuration that depends on other providers (like a `ConfigService`).

#### Implementation Strategy

1. **Define Options Interface**: Create a clear interface for the module's configuration.
2. **Create Injection Token**: Use a `unique symbol` or a string to represent the options in the DI container.
3. **The Static `forRoot`**:
   ```ts
   static forRoot(options: MyModuleOptions): DynamicModule {
     return {
       module: MyModule,
       providers: [
         { provide: MY_OPTIONS, useValue: options },
         MyService,
       ],
       exports: [MyService],
     };
   }
   ```
4. **The Factory-based `forRootAsync`**:
   This requires `AsyncModuleOptions` which allows users to provide a factory function and an `inject` array.

## The exports Field and Visibility Contract

In fluo, the `exports` field in a `@Module` is not just a hint—it is a strictly enforced contract. The `ModuleGraph` during the bootstrap phase validates that only exported tokens are accessible by other modules.

### Visibility Rules

1. **Local Visibility**: Every provider is visible within the module it is defined in.
2. **Exported Visibility**: A provider becomes visible to modules that `import` the defining module ONLY if it is listed in the `exports` array.
3. **Re-exports**: A module can re-export another module. This makes the exports of the imported module available to whoever imports the "proxy" module.
4. **Global Modules**: Modules decorated with `@Global()` bypass the need for explicit imports, but their providers still need to be exported to be visible.

## Practical Example: Feature-Flags Mini-Package

Let's build a simple feature-flags package to demonstrate these concepts. This package will allow us to toggle features based on configuration.

### 1. Structure

```text
packages/feature-flags/
├── src/
│   ├── index.ts
│   ├── feature-flags.module.ts
│   ├── feature-flags.service.ts
│   ├── constants.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

### 2. Defining the Types and Tokens

```ts
// types.ts
export interface FeatureFlagsOptions {
  flags: Record<string, boolean>;
}

// constants.ts
export const FEATURE_FLAGS_OPTIONS = Symbol('FEATURE_FLAGS_OPTIONS');
```

### 3. The Service

The service consumes the options provided by the module.

```ts
@Inject(FEATURE_FLAGS_OPTIONS)
export class FeatureFlagsService {
  constructor(private readonly options: FeatureFlagsOptions) {}

  isEnabled(feature: string): boolean {
    return !!this.options.flags[feature];
  }
}
```

### 4. The Dynamic Module

This is where we implement the `forRoot` and `forRootAsync` logic.

```ts
@Module({})
export class FeatureFlagsModule {
  static forRoot(options: FeatureFlagsOptions): DynamicModule {
    return {
      module: FeatureFlagsModule,
      providers: [
        { provide: FEATURE_FLAGS_OPTIONS, useValue: options },
        FeatureFlagsService,
      ],
      exports: [FeatureFlagsService],
    };
  }

  static forRootAsync(options: AsyncModuleOptions<FeatureFlagsOptions>): DynamicModule {
    return {
      module: FeatureFlagsModule,
      imports: options.imports || [],
      providers: [
        {
          provide: FEATURE_FLAGS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        FeatureFlagsService,
      ],
      exports: [FeatureFlagsService],
    };
  }
}
```

## Best Practices for Library Design

### Minimize Core Dependencies

Your package should ideally only depend on `@fluojs/core`. Avoid pulling in `@fluojs/platform-*` unless you are specifically writing a platform adapter. This keeps your library portable across Node.js, Bun, and Workers.

### Explicit Token Naming

When defining injection tokens for configuration, use a clear and unique naming convention to avoid collisions with other libraries. `Symbol.for('@fluojs/feature-flags:options')` is a good pattern.

### Normalization of Metadata

The fluo runtime normalizes missing metadata fields (like `exports: []` if omitted). However, as a library author, being explicit improves readability and helps tools like fluo Studio visualize your module graph correctly.

### Handling Circular Dependencies

In complex ecosystems, circular module dependencies can occur. Use `forwardRef()` both in `imports` and `inject` arrays to allow the DI container to resolve these cycles gracefully.

## Conclusion

Creating a custom package for fluo is about respecting the boundaries defined by the module system. By following the patterns found in `@fluojs/core` and `@fluojs/di`, and by implementing the `forRootAsync` pattern, you ensure that your library integrates seamlessly into any fluo application.

In the next and final chapter, we will look at how you can contribute these packages and improvements back to the fluo core repository itself.

---
<!-- lines: 212 -->

















































































