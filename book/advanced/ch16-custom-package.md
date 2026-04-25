<!-- packages: @fluojs/core, @fluojs/di, @fluojs/runtime -->
<!-- project-state: advanced -->

# Chapter 16. Creating Custom Packages

This chapter explains how to design reusable packages inside the fluo ecosystem and define their public surface in a stable way. Chapter 15 covered tools for observing internal structure. This chapter moves from that structure into the practical work of creating a new extension unit on top of it.

## Learning Objectives
- Understand how fluo monorepo packages separate public surfaces from internal implementations.
- Learn how the `exports` field and entrypoint design affect package stability.
- Learn how to apply the `DynamicModule`, `forRoot`, and `forRootAsync` patterns to a package API.
- Walk through the flow for designing an extensible Module through option Tokens and Provider configuration.
- Analyze package structure, service design, and Module composition through a feature flag example.
- Summarize library design principles such as visibility contracts and circular dependency handling.

## Prerequisites
- Complete Chapter 13 through Chapter 15.
- Basic understanding of TypeScript package structure and the `exports` field in `package.json`.
- Basic understanding of the fluo Module system, DI, and the Dynamic Module pattern.

## Monorepo Package Structure

The fluo monorepo follows a strict organization pattern to keep cohesion high and coupling low. Every official package uses a predictable layout, and custom packages should usually follow the same structure. This structure is not just cleanup. It is a contract checked by build tooling to keep quality consistent across the ecosystem.

### Public Surface and Internal Seams

In fluo, visibility is a first-class design element. A package usually exposes functionality through a specific set of entrypoints defined in the `exports` field of `package.json`. This prevents "deep imports" into internal files and makes consumers depend only on a stable public API.

```json
{
  "name": "@fluojs/my-package",
  "exports": {
    ".": "./dist/index.js",
    "./internal": "./dist/internal/index.js"
  }
}
```

1. **`index.ts` (public root)**: This file should contain only re-exports of public APIs, decorators, and types. It acts as the package's "front door."
2. **`module.ts`**: The `Module` definition is often isolated in this file. That lets consumers import logic without pulling in framework-specific metadata when they only need types or utilities.
3. **`internal/`**: This directory contains implementation details that are not part of the public contract. This split clearly signals that those APIs can change without a semver warning.

### Dependency Declaration

fluo packages generally depend on three core pillars.
- `@fluojs/core`: Provides the metadata backbone (`@Module`, `@Global`, `@Inject`).
- `@fluojs/di`: Provides the Token-based container and Provider model.
- `@fluojs/runtime`: Needed only when performing manual Bootstrap or graph manipulation.

When building a library, it is best to keep `@fluojs/core` and `@fluojs/di` as `peerDependencies` to avoid version conflicts in the user's dependency graph. Be especially careful with `@fluojs/di`, because multiple injection engine instances can cause unexpected behavior during Token resolution.

## Designing DynamicModules

The `DynamicModule` pattern is the main way fluo provides configurable functionality. Unlike static Modules defined at compile time, Dynamic Modules are created at runtime and usually accept a configuration object.

### The DynamicModule Contract

A `DynamicModule` is an object, or a class with a static method that returns an object, that satisfies the `ModuleMetadata` interface plus a `module` reference. The important point is that it keeps the same metadata shape as a static Module while allowing options and Provider configuration to be created at call time.

```ts
export interface DynamicModule extends ModuleMetadata {
  module: Type<any>;
}
```

Components of a Dynamic Module:
- `imports`: Other Modules required by this dynamic instance.
- `providers`: Custom Providers, including the configuration object.
- `exports`: Providers exposed to importing Modules.
- `global`: Boolean flag for marking the Module as global.

### The forRoot and forRootAsync Pattern

Following the community standard, fluo libraries use `forRoot` for static configuration and `forRootAsync` for configuration that depends on other Providers, such as `ConfigService`. These names help users immediately understand whether the Module accepts direct options or resolves configuration through DI.

#### Implementation Strategy

1. **Define an options interface**: Create a clear interface for Module configuration.
2. **Create an injection Token**: Use a `unique symbol` or string to represent the options in the DI container.
3. **Static `forRoot`**:
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
4. **Factory-based `forRootAsync`**:
   To let users provide a `useFactory`, `useClass`, or `useExisting` strategy, you need `AsyncModuleOptions`. The `inject` array is important because it resolves dependencies such as `ConfigService` before the factory runs.

## The exports Field and Visibility Contract

In fluo, the `exports` field of `@Module` is not a simple hint. It is a strictly enforced contract. During the Bootstrap phase, the `ModuleGraph` verifies that other Modules can access only exported Tokens.

### Visibility Rules

1. **Local visibility**: Every Provider is visible inside the Module where it is defined.
2. **Exported visibility**: A Provider is visible to Modules that `import` its defining Module only when it is listed in the `exports` array.
3. **Re-exports**: A Module can re-export another Module. This makes the exports of the imported Module available to every Module that imports the "proxy" Module.
4. **Global Modules**: A Module with the `@Global()` decorator does not require explicit imports, but its Providers still need to be exported to be visible across the full application graph.

## Practical Example: Feature-Flags Mini-Package

To check these concepts, let's build a small feature flags package. This package lets features be turned on and off through configuration. Because the example is small, it makes the relationship between public surface, option Token, Service, and Dynamic Module easy to see.

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
export const FEATURE_FLAGS_OPTIONS = Symbol.for('@fluojs/feature-flags:options');
```

### 3. The Service

The service consumes the options provided by the Module. Because the options arrive through an injection Token, the service does not need to know whether configuration came from static `forRoot` options or an async factory.

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

This Module implements the `forRoot` and `forRootAsync` logic. Both methods export the same service, but they absorb the difference in how option values are prepared.

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

Packages should depend only on `@fluojs/core` when possible. Do not import `@fluojs/platform-*` unless you are directly writing a Platform Adapter. This keeps the library platform-independent across Node.js, Bun, and Cloudflare Workers.

### Explicit Token Naming

When defining injection Tokens for configuration, use a clear and unique naming convention to avoid collisions with other libraries. `Symbol.for('@fluojs/feature-flags:options')` is the recommended pattern. It keeps the symbol unique in the global symbol registry while leaving a descriptive name.

### Normalization of Metadata

The fluo runtime normalizes missing metadata fields, such as `exports: []` when omitted. Still, library authors should write them explicitly. This improves readability and helps tools such as **fluo Studio** visualize the Module Graph correctly. A clear `exports` array is the most direct way to communicate the Module's "public surface."

### Handling Circular Dependencies

In complex ecosystems, circular dependencies can appear between Modules. Use `forwardRef()` in both `imports` and `inject` arrays so the DI container can resolve these cycles lazily. This pattern is often needed when two Modules must share Providers while keeping strict encapsulation. Still, treat it as a signal to check whether shared responsibility should be moved into a separate Module instead of only hiding the cycle.

## Conclusion

Creating a custom package for fluo means respecting the boundaries defined by the Module system. By following the patterns used in `@fluojs/core` and `@fluojs/di`, and by implementing the `forRootAsync` pattern, your library fits naturally into the Module Graph of a fluo application.

In the next and final chapter, we will see how to contribute these packages and improvements back to the fluo core repository itself, following the official contribution guide and Behavioral Contract policy.
