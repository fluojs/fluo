<!-- packages: @fluojs/config -->
<!-- project-state: FluoBlog v1.8 -->

# Chapter 11. Configuration Management

This chapter explains the basics of configuration management for turning FluoBlog from an application with hardcoded values into one that can be adjusted per environment. Chapter 10 documented the HTTP surface. Now it's time to handle the internal runtime environment safely and predictably.

## Learning Objectives
- Understand why environment variables should be handled explicitly.
- Register `ConfigModule` and load configuration from a `.env` file.
- Learn the priority order of configuration sources in `fluo`.
- Use `ConfigService` to inject configuration into Providers.
- Implement configuration validation with Zod or a simple schema checker.
- Refactor FluoBlog away from hardcoded values into a production-ready configurable structure.

## Prerequisites
- Completion of Chapter 10.
- A basic understanding of FluoBlog's `AppModule` and bootstrap flow.
- Familiarity with the basic concepts of `.env` files and environment variables.

## 11.1 The Need for Explicit Configuration
Hardcoding values such as database URLs, API keys, and port numbers directly into code is risky. These values change with the runtime environment, such as local development, staging, or production. When they're mixed into source code, deployment differences can easily become bugs.

Most Node.js developers are used to reading `process.env` directly. It looks convenient at first, but once global state is read throughout the codebase, testing becomes harder and it's difficult to trace which code depends on which setting.

`fluo` recommends an **Explicit** approach to configuration management. With the `@fluojs/config` package, you can centralize how the application finds, merges, and validates configuration, which also makes the flow in this chapter clearer. Define required configuration in one place, inject it where needed, and fail early when important values are missing.

### Why Explicit over Ambient?
The "Ambient" approach, which simply hopes global variables exist, is dangerous. `fluo` emphasizes explicitness for these reasons:
- **Predictability**: You know exactly where every configuration value comes from.
- **Fail-Fast**: When required configuration is missing, the system prevents application startup, avoiding execution in an unstable state.
- **Type Safety**: Instead of string-based lookup on a plain object, configuration can be accessed safely through a typed service.
- **Testability**: Configuration values can be replaced or mocked easily in unit and integration tests without polluting the global environment.

### The Role of Configuration in Modular Architectures
In a modular backend like FluoBlog, each Module can have its own configuration needs. `ConfigService` lets you separate Modules from the global environment. For example, `UsersModule` doesn't need to know how the `.env` file is read. It only needs to request the required setting from `ConfigService`. This separation helps the application grow without tangled dependencies, and keeps the structure readable as the number of Modules increases later.

### Scaling Configuration as Your App Grows
As FluoBlog grows from a few files into dozens of Modules, the cost of configuration management grows with it. In an implicit system, you may need to search the entire codebase to find where a specific environment variable is used. With `ConfigService`, you can create a centralized source of truth that scales with the application.

This approach also makes it much easier to move to professional secret management tools such as HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault. Instead of editing every file that uses secrets, you only update the `ConfigModule` logic so it reads values from those external Providers.

### Configuration as a Behavioral Contract
Configuration is a contract between the application and its runtime environment. When you explicitly define which settings are required, you also make it clear what conditions the environment must provide. If the environment doesn't satisfy that contract, the application refuses to start and avoids the risk of running in an undefined state. This kind of behavioral contract is a basic requirement for building predictable backend systems that are easy to reason about.

### Prediction and Robustness: The Config Advantage
Using `ConfigModule` makes the application's configuration path predictable. Many production incidents are caused by simple configuration mistakes, such as a typo in a database URL or an invalid API key. With an explicit configuration system, those errors can be caught during application startup instead of waiting until a specific user action triggers them.

Predictability means that by looking at `AppModule`, you can understand which external services and settings the application depends on. The same structure helps when moving from a local development environment to the cloud, or from a single instance to a global cluster. When configuration boundaries are clear, there are fewer points to check as deployment environments change.

### Understanding the Internal Mechanism of Configuration
When a fluo application starts, `ConfigModule` explicitly composes configuration sources. First, it identifies the provided `envFile` path. If the file exists, it uses a parser to read key-value pairs and stores them in a private in-memory map. Then it merges them with `defaults` defined in code and, if needed, a `processEnv` snapshot explicitly passed to `forRoot(...)`.

This initialization step is important because it happens during the framework core's `OnModuleInit` lifecycle hook. By the time `AppModule` has fully loaded, `ConfigService` is already populated with the final merged configuration state and ready to be injected where it's needed most.

## 11.2 Setting up ConfigModule

Now that you understand why explicit configuration matters, it's time to reflect that principle in the application structure. To start configuration management, first install and register `ConfigModule`.

```bash
pnpm add @fluojs/config
```

Installing `@fluojs/config` gives you a specialized toolset for parsing environment files and managing an in-memory configuration map. Unlike a typical `dotenv` library, this package integrates deeply with the fluo lifecycle, naturally participates in the application's startup sequence, and provides a solid foundation for all later Module initialization.

Let's update `AppModule` so FluoBlog centralizes its configuration logic.

### Why getOrThrow is your Best Friend
In many legacy Node.js apps, developers use patterns like `process.env.DB_URL || 'default_url'`. This looks safe on the surface, but it often hides configuration mistakes in production. If a default value is applied, the application may start even though it's already in an invalid state, leading to subtle bugs and failures that are hard to trace.

The `ConfigService.getOrThrow()` method is designed to prevent this kind of silent failure. If the requested key is missing, fluo raises a `FluoError` with code `CONFIG_KEY_MISSING`, allowing startup or the caller's bootstrap path to fail fast. This lets you catch misconfiguration early, before the system runs with invalid settings.

Using `getOrThrow()` confirms that every dependency has been explicitly satisfied. The application starts only from a well-defined state, and missing configuration is treated as a deployment-time error rather than a runtime failure. This transparency is the practical effect of fluo's emphasis on explicitness.

### Understanding the Config Snapshot
Behind the scenes, `ConfigService` keeps a normalized in-memory snapshot of the merged configuration values. Reads through `get()`, `getOrThrow()`, and `snapshot()` return detached clones for object-like values, so caller mutations cannot modify the active configuration snapshot. The service does not expose per-key provenance; if you need to know where a value came from, keep that information in your own bootstrap code alongside the options passed to `ConfigModule.forRoot(...)`.

### Registration in AppModule
Open `src/app.module.ts` and add `ConfigModule` to the `imports` array.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Environment file path
      envFile: '.env',
      // Reasonable defaults for local development
      defaults: {
        PORT: 3000,
        NODE_ENV: 'development',
      },
    }),
  ],
})
export class AppModule {}
```

### Precedence Rules and Conflict Resolution
When `fluo` merges configuration sources, it follows a strict priority order. This order is designed to keep flexibility while maintaining a single source of truth for each setting.
1. **Runtime Overrides**: Values passed directly from code, with the highest priority.
2. **Explicit ProcessEnv Snapshot**: Values passed to `processEnv` in `forRoot(...)`.
3. **Environment File**: Values defined in the `.env` file.
4. **Defaults**: Defaults hardcoded in the Module options, with the lowest priority.

This hierarchy lets you define reasonable defaults while still allowing environment-specific overrides in CI/CD or production. In other words, you keep convenience during development while applying stronger control to required values in real deployments.

### Managing Complex Precedence Scenarios
In advanced deployment scenarios, you may need multiple environment files or runtime overrides that are computed dynamically. The precedence system guarantees that these values are merged in a predictable way. For example, if you provide a runtime override for a variable that also exists in `.env`, the runtime value always wins, letting you test a specific setting without editing the environment file.

### Best Practices for Config Defaults
When setting `defaults` in `ConfigModule.forRoot`, aim for values that let the application start in a "safe but limited" mode. For example, defaulting `PORT` to 3000 is standard, but you should avoid providing a default for `DATABASE_URL`. If database configuration is missing, it's far better for the app to fail fast than to try a generic connection string and fail later.

Also consider using `defaults` for toggles that should be off by default in development but on in production, such as strict SSL checks for external services. Keeping these defaults explicit in code reduces onboarding friction for new developers who join the team.

### Team Collaboration and Config
In a team environment, explicit configuration lowers collaboration costs. When a new teammate joins the project, they can look at the `ConfigModule` setup in `AppModule` and understand which settings the app needs to run. This documents infrastructure requirements in code instead of relying on tribal knowledge.

Using `defaults` also helps team members customize settings for their local environments while sharing the common base values everyone needs, which keeps development environments consistent.

This explicit approach also simplifies code review. When a PR introduces a new setting, it's immediately clear where and how that setting is defined and used. There are no hidden environment variables that a developer might forget to document or explain. This level of clarity is essential for maintaining a high-quality codebase that everyone can understand and contribute to.

### Centralized Source of Truth
`ConfigService` acts as the single source of truth for the whole application. By aggregating all external configuration through this service, you remove the risk that different parts of the application use conflicting values for the same setting. This centralized control is a key part of building a reliable backend that behaves consistently across every deployment environment.

### Convention: Environment Variable Naming
`fluo` doesn't enforce a naming convention, but it strongly recommends following industry standards such as `UPPER_SNAKE_CASE`, for example `REDIS_HOST` and `MAX_RETRIES`. This makes `.env` files easier to read and keeps them consistent with other tools in the DevOps ecosystem.

If you plan to deploy several fluo applications in the same environment or container mesh, also consider using service-specific prefixes, such as `BLOG_PORT` instead of a plain `PORT`. This prevents name collisions and makes the purpose of each setting very clear.

### Injecting the ConfigService into Other Providers
Once registration is complete, `ConfigService` becomes available anywhere in the application through Dependency Injection (DI). This makes it very easy to provide configuration values to any part of the system. Whether it's an API service, a database repository, or a logging Module, `ConfigService` is ready to supply the loaded configuration.

This pattern is a major improvement over traditional global state management. Instead of accessing global variables, you simply request `ConfigService` in the constructor. This is cleaner and more explicit, and it's also much easier to test. During unit tests, you can easily provide a mock `ConfigService` with controlled values and verify component behavior across different configuration scenarios.

The DI-based approach also prevents hidden dependencies. In legacy apps, `process.env` calls are often buried deep inside utility functions, making it hard to know which environment variables a function needs to work. With `ConfigService`, every dependency is clearly listed in the constructor, so the application's data flow is transparent and predictable. The framework also manages the configuration lifecycle, ensuring configuration is loaded and validated before dependent services are instantiated.

## 11.3 Using ConfigService

Once registration is complete, the Module handles configuration loading, while application code reads values through `ConfigService`. Separating these roles keeps business code from being pulled into configuration loading details, so it can focus only on using the values it needs.

### Injecting the Service
In the bootstrap logic, `main.ts`, you can use the service configuration to decide which port to listen on.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { ConfigService } from '@fluojs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await FluoFactory.create(AppModule);
  
  const config = app.get(ConfigService);
  const port = config.get('PORT');
  
  await app.listen(port);
}
```

Inside a service or Controller, use it like this.

```typescript
import { Inject } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

@Inject(ConfigService)
export class ApiService {
  constructor(private readonly config: ConfigService) {}

  getExternalApiUrl() {
    // Using getOrThrow ensures the app fails immediately when a required key is missing.
    return this.config.getOrThrow('EXTERNAL_API_URL');
  }
}
```

This example assumes that `ApiService` is registered in the `providers` array of its Module.

## 11.4 Advanced Pattern: Validation Schemas
One common production failure is an application starting with an empty or invalid database URL. You can prevent this by validating configuration during bootstrap. This not only makes the application more reliable, it also gives operators much clearer error messages. Instead of a vague database connection error, they can see exactly which configuration key failed validation and why.

This is why schemas matter. By defining a schema for configuration, you create a contract that the environment must satisfy. This contract includes expected data types, range constraints, required fields, and more. If any part of the contract is violated, fluo refuses to start and protects the system from unpredictable behavior on a poorly configured node.

### The Benefits of Zod Integration
A simple schema check is better than none, but a library like **Zod** gives you a powerful declarative way to define the application's physical constraints. With Zod, you can:
- **Coerce Types**: Automatically convert the string "3000" from a `.env` file into a proper JavaScript number.
- **Set Range Constraints**: Check that `PORT` is within a valid range, such as 1024 to 65535.
- **Validate URL Format**: Check that `DATABASE_URL` is a correctly formatted string that starts with `postgresql://`.
- **Transform**: Convert `NODE_ENV` to uppercase or trim whitespace from API keys.

For important settings such as database credentials, using `getOrThrow()` is strongly recommended. It ensures that the application never runs in a broken state, and it naturally leads into the next step, configuration validation.

```typescript
import { z } from 'zod'; // Optional validation library

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
});

ConfigModule.forRoot({
  schema: ConfigSchema,
})
```

By validating during `forRoot`, Fluo raises a detailed `INVALID_CONFIG` error and **stops bootstrap** when configuration is invalid. The schema's validated `value` becomes the final config snapshot, so coercions such as `PORT` becoming a number are visible through `ConfigService`. Config schemas must validate synchronously; async Standard Schema results are rejected by the synchronous config API. This ensures that a misconfigured node is never put into load balancer rotation.

One common production bug is an application starting with only partially valid configuration. If it boots with some values present and others missing, the problem may appear only after a real request arrives, making the root cause harder to find. With `fluo`, you can validate configuration during bootstrap, so a half-configured state is blocked at startup instead of being carried into runtime. Configuration validation is not just a convenience. It is a safety barrier that keeps misconfigured instances out of production traffic.

### Real-world Scenario: Production Guardrails
Imagine a production deployment script has a bug and fails to inject `DATABASE_URL`. In a traditional application, the process might start and the failure might not be discovered until minutes later, when the first user tries to sign up, causing a 500 error and a poor user experience.

With `ConfigModule` and Zod validation, however, the application detects the missing URL within milliseconds of startup. The deployment fails immediately and prevents the defective version from reaching users at all. This fail-fast mechanism is a cornerstone of site reliability engineering (SRE), and it's built into fluo's design. It turns a potential runtime disaster into a manageable deployment-time error.

## 11.5 FluoBlog: Moving to Config
You now have all the concepts you need. The current FluoBlog project may still contain hardcoded values, so this section connects what you learned above to practical cleanup work in the project.

1. **Create `.env`**:
   ```env
   PORT=4000
   DATABASE_URL=postgresql://user:pass@localhost:5432/blog
   ```

2. **Access through the service**:
Replace the hardcoded port or repository URL in `main.ts` with a `ConfigService` lookup.

Then use the following in `app.module.ts`.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
    }),
  ],
})
export class AppModule {}
```

This pattern lets you combine the env file and the explicitly passed environment snapshot in one place. And when you connect the database in the next chapter, you'll be able to see at a glance where the connection information comes from.

### Security Note: .gitignore and Configuration
You may be tempted to commit the `.env` file to GitHub so teammates can run the project easily. **Never do that.** Environment files often contain sensitive secrets such as database passwords, private encryption keys, and third-party API tokens.

The standard practice is:
1. Add `.env` to the `.gitignore` file.
2. Create a `.env.example` file that includes only keys, not real values, for example `PORT=3000` and `DATABASE_URL=ENTER_URL_HERE`.
3. Share real secrets through a secure vault or a shared team password manager.

## 11.6 Multi-Environment Patterns
Larger projects usually need different configuration for `test`, `dev`, and `prod` environments. You can handle this by selecting `envFile` dynamically.

```typescript
ConfigModule.forRoot({
  envFile: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
})
```

### Advanced Precedence: Docker and Kubernetes
When running fluo in container environments such as Docker or Kubernetes, you often want to skip `.env` files entirely and use the orchestrator's environment variable system. Even in this case, `@fluojs/config` doesn't automatically scan the ambient `process.env`. Instead, explicitly pass the required values as `processEnv` at the bootstrap boundary, and that snapshot will take priority over `.env`.

This lets you use convenient `.env` files during local development while ensuring production configuration is managed by infrastructure as code (IaC) tools. The transition from a developer laptop to a large cloud cluster becomes smooth.

### Handling Sensitive Secrets in Production
In production, sensitive secrets such as database passwords or API keys should not be stored as plaintext in text files in the repository or on server disk. Instead, use the platform's secret management features. In Kubernetes, use `Secrets` objects to inject values into pods as environment variables. In AWS, you may use an initialization script integrated with `Secrets Manager`.

Separating application logic from sensitive data in this way is critical for maintaining safe and auditable backend infrastructure.

### Local Development vs. Production Workflows
A healthy development workflow draws a clear line between how configuration is handled in a developer's local environment and in a production cluster. Locally, fast setup and convenience matter, and `.env` files plus reasonable `defaults` shine there. In production, security, auditability, and centralized management take priority, which makes precedence rules and platform-specific environment variable integration essential. By designing the configuration system for both modes, you make the path from code to cloud smoother.

### Troubleshooting Config Issues
When debugging configuration issues, it's useful to check which values `ConfigService` actually read. But be careful not to print passwords or API keys in plaintext logs. `ConfigService` exposes the active merged snapshot, not per-key source provenance, so compare the values you passed through `defaults`, `.env`, `processEnv`, and runtime overrides when tracing where a setting came from.

If configuration doesn't behave as expected, check this list:
1. Confirm that the `.env` file name is correct.
2. Check for typos in environment variable names.
3. Check whether system environment variables are overriding the `.env` file according to the precedence rules.
4. Confirm that `ConfigModule` is placed at the top of `AppModule`'s `imports`, so configuration can load before other Modules initialize.

## 11.7 Summary

In this chapter, we moved from magical environment variables to a structured configuration system the whole application can trust.

We learned the following.
- Explicit configuration is safer and easier to test.
- `ConfigModule` centralizes configuration loading and merging.
- `ConfigService` provides a typed, injectable interface for application logic.
- Precedence rules let production environments override local defaults.
- Validation at startup prevents unstable application states.

With the configuration management foundation in place, FluoBlog has taken an important step toward being production-ready. Since core settings such as ports, secrets, and database connection information can now be loaded predictably, you're ready to move on. In the next chapter, we'll use these configuration techniques to connect FluoBlog to a real database through Prisma.

## 11.8 Detailed Configuration Scenarios

### Handling Optional Configurations
Sometimes you may want to provide a feature only when a specific configuration key exists. `getOrThrow` is suitable for required settings, while `get` can be used for optional settings. Even for optional settings, though, it's best to provide defaults in `forRoot` to keep business logic clean.

For example, if you have an optional feature called analytics tracking, you can set it to `false` by default in code. Then service layers can always work with a boolean value instead of handling `undefined` or `null` throughout the codebase. This Safe Default pattern simplifies code and makes it more resilient.

### Environment Variable Interpolation
Sometimes one configuration value depends on another. For example, `LOG_PATH` may be relative to `APP_ROOT`. Some dotenv libraries support interpolation such as `${APP_ROOT}/logs`, but fluo recommends handling this explicitly in a `ConfigModule` factory or validation step. This keeps the logic clear and makes debugging easier.

Explicit interpolation preserves configuration predictability and avoids problems caused by complex regex-based string replacement in some libraries. Handling it in TypeScript also gives you full type safety and lets you use standard string manipulation functions.

### Configuration Inheritance and Merging
In large organizations, common configuration may need to be shared across multiple microservices. Even in this case, the basic entrypoint is `ConfigModule.forRoot(...)`. For example, you can read global settings ahead of time from a shared JSON file or remote configuration server, pass them through `defaults` or `processEnv`, and then merge them with local `.env` configuration.

This layered approach preserves consistency across the full service set while still giving each service the flexibility to override settings for its own needs. It's a strong pattern for infrastructure management at scale.

### Dynamic Configuration Reloading
Most configuration is loaded at startup, but some applications may need to change configuration without restarting. fluo's `ConfigService` is designed for startup configuration by default, but dynamic reloading can be implemented by watching file system events or external triggers and updating the service's internal state.

However, dynamic reloading should be used carefully because it can introduce race conditions and make application state harder to reason about. In most cases, rolling restarts of containers are a safer and more predictable way to propagate configuration changes in production.

### Auditing Configuration Access
For security-sensitive applications, you may want to audit which services access specific configuration keys, especially secrets. You can implement this by wrapping `ConfigService` or using fluo's internal hooks to record every call to `get` and `getOrThrow`. This provides a clear audit trail for how sensitive data moves through the system.

Auditing access to secrets is a core requirement in many regulatory frameworks, such as SOC2 and PCI-DSS. Building this capability into the configuration layer makes those requirements easier to satisfy and helps ensure the long-term security of backend infrastructure.

### Integration with External Secret Stores
In addition to environment variables, many production systems use dedicated secret stores such as AWS Secrets Manager or HashiCorp Vault. These values can also be read first at the bootstrap boundary and passed to `ConfigModule.forRoot(...)` as a `processEnv` snapshot or `defaults`. That keeps application logic the same no matter where secrets are actually stored.

This Provider pattern for secrets lets developers work with local `.env` files while keeping production systems highly secure. It's a hallmark of professional software architecture and is fully supported by fluo's flexible configuration system.

### The Role of Configuration in Feature Toggles
Configuration is also the foundation for feature toggles, or feature flags. By using configuration keys to enable or disable specific pieces of code, you can safely deploy new features to production and then turn them on for specific users or environments. This is a core principle of modern DevOps because it separates deployment from release.

fluo's explicit configuration system makes feature toggles simple to implement. When combined with the metrics from Chapter 19, you can also roll out new features gradually while tracking performance and usage in real time. This data-driven approach to feature delivery is how the world's best engineering teams build and ship software.

### Managing Configuration for Serverless
Configuration management has unique constraints when running in serverless environments such as AWS Lambda or Cloudflare Workers. Cold start time matters, so configuration loading logic should be as fast as possible. fluo's lightweight `@fluojs/config` package is optimized for these environments, helping functions start quickly and efficiently.

Many serverless platforms also have their own ways of injecting environment variables. fluo's precedence rules ensure that platform-injected variables always take priority, allowing serverless functions to adapt cleanly to the host environment without code changes.

### Final Thoughts on Configuration
Skilled configuration management is the difference between fragile scripts and solid backend systems. By adopting fluo's explicit, verifiable, and layered approach, you build a foundation that can support your application from the first prototype to global production deployment.

Explicit configuration is stronger in operations than implicit global lookup. By making dependencies clear and requirements mandatory, your team can reduce the recurring backend problems caused by missing configuration and environment drift.
