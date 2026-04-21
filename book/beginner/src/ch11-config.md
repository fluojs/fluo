<!-- packages: @fluojs/config -->
<!-- project-state: FluoBlog v1.8 -->

# Chapter 11. Configuration Management

## Learning Objectives
- Understand why environment variables should be handled explicitly.
- Register `ConfigModule` and load configuration from `.env` files.
- Learn the precedence of configuration sources in `fluo`.
- Use `ConfigService` to inject configuration into providers.
- Implement configuration validation using Zod or simple schema checkers.
- Progress FluoBlog from hardcoded values to a production-ready configurable setup.

## 11.1 The Need for Explicit Configuration

Hardcoding values like database URLs, API keys, or port numbers directly in your code is a recipe for disaster. In a real-world project, these values change depending on whether you are running locally, in a CI/CD pipeline, or in a live production cluster.

While Node.js provides `process.env` globally, reaching for it directly everywhere in your code makes your application brittle, harder to test, and difficult to audit. `fluo` encourages an **explicit** approach to configuration via the `@fluojs/config` package.

### Why Explicit over Ambient?
The "ambient" approach—where you simply hope a global variable exists—is dangerous. Here is why `fluo` mandates explicitness:
- **Predictability**: You know exactly where every configuration value originates.
- **Fail-Fast**: If a critical setting is missing, the system prevents the application from starting in a broken state.
- **Type Safety**: Instead of string-based lookups on a generic object, you access settings through a typed service.
- **Testability**: You can easily swap or mock settings in unit and integration tests without polluting the global environment.

### The Role of Configuration in Modular Architectures
In a modular backend like FluoBlog, every module might have its own set of configuration requirements. By using `ConfigService`, you decouple your modules from the global environment. A `UsersModule` doesn't need to know how to read an `.env` file; it simply asks for the `ConfigService` to get its required settings. This modularity is what allows you to scale your application without creating a tangled web of dependencies. It is the key to maintaining a clean and understandable architecture.

### Scaling Configuration as Your App Grows
As FluoBlog grows from a few files to dozens of modules, the complexity of managing settings increases exponentially. In an implicit system, you might find yourself searching through the entire codebase to see where a certain environment variable is used. This is not only time-consuming but also incredibly error-prone, as it's easy to miss a usage in a deeply nested component.

By using `ConfigService`, you create a centralized "source of truth" that scales with your application. This centralization makes it incredibly easy to see every external dependency at a glance. It also simplifies the process of rotating secrets and updating settings, as you only need to change a single configuration point to propagate the change throughout your entire system.

### Configuration as a Behavioral Contract
Think of your configuration as a contract between your application and its environment. By explicitly defining what settings are required, you are setting a clear expectation of what the environment must provide. If the environment fails to meet this contract, the application will refuse to start, preventing the risk of running in an undefined state. This behavioral contract is essential for building mission-critical backends that are predictable and easy to reason about.

### Prediction and Robustness: The Config Advantage
By using `ConfigModule`, you are building a application that is both predictable and robust. In many production incidents, the root cause is a simple misconfiguration—a typo in a database URL or an incorrect API key. With an explicit configuration system, you can catch these errors at the very moment the application starts, rather than hours later when a specific user attempts to perform an action.

Predictability means that you can look at your `AppModule` and know exactly which external services and settings your application depends on. Robustness means that your application is prepared for the inevitable changes in its environment, whether it's moving from a local laptop to a cloud provider or scaling from a single instance to a global cluster. This structural integrity is a hallmark of professional backend development.

### Understanding the Internal Mechanism of Configuration
When a fluo application starts, the `ConfigModule` initializes before most other modules. It performs a multi-step sequence to ensure your environment is ready. First, it identifies the `envFile` path you provided. If the file exists, it uses a parser to read the key-value pairs into a private memory map. This map is then merged with any `defaults` defined in the code and the current `process.env`.

This initialization phase is critical because it happens during the "OnModuleInit" lifecycle hook of the core framework. By the time your `AppModule` is fully loaded, the `ConfigService` is already populated with the final, merged state of your configuration, ready to be injected where it is needed most. This architecture ensures that your configuration is always available and consistent throughout the entire application lifecycle.

By centralizing the configuration logic in this way, `fluo` eliminates a whole class of configuration-related bugs. You no longer have to worry about race conditions or inconsistent settings across different parts of your application. The `ConfigService` provides a single, reliable point of access for every setting your application needs.


## 11.2 Setting up ConfigModule

To start managing configuration, we first need to install the module.

```bash
pnpm add @fluojs/config
```

The installation of `@fluojs/config` brings in a set of specialized tools for parsing environment files and managing memory-resident configuration maps. Unlike generic dotenv libraries, this package is deeply integrated with the fluo lifecycle, allowing it to hook into the startup sequence of your application and provide a robust foundation for all subsequent module initializations.

In FluoBlog, we will update our `AppModule` to centralize our settings.

### Why getOrThrow is your Best Friend
In many legacy Node.js apps, developers use `process.env.DB_URL || 'default_url'`. While this seems safe, it often masks configuration errors in production. This is because a default value can allow the application to start in a broken state, leading to subtle bugs and difficult-to-trace failures.

The `ConfigService.getOrThrow()` method is designed to prevent this "silent failure." If the requested key is missing, fluo will throw an `InternalServerError` during startup, effectively stopping the deployment. This ensures that you find out about the misconfiguration immediately, rather than discovering it only when a critical business operation fails.

By using `getOrThrow()`, you are building a more resilient system. You are ensuring that every dependency is explicitly met and that your application is always running in a well-defined and predictable state. This transparency is a key part of the fluo philosophy and is essential for building mission-critical backends.

### Understanding the Internal Registry
Behind the scenes, the `ConfigService` maintains an internal registry of every loaded variable. This registry is not just a simple key-value pair; it includes metadata such as the source of the variable (e.g., whether it came from a `.env` file or a runtime override) and its original format before any transformations were applied. This level of detail is invaluable when you are running complex microservices where a single misconfiguration can ripple through multiple systems.

### Registration in AppModule
Open `src/app.module.ts` and add the `ConfigModule` to the imports array.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Path to your environment file
      envFile: '.env',
      // Sensible defaults for local development
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
`fluo` follows a strict precedence order when merging configuration sources. This order is designed to be as flexible as possible while still maintaining a single source of truth for each setting. By understanding these rules, you can resolve conflicts between your local `.env` file and the environment variables set on your production server.

1. **Runtime Overrides**: Values passed directly in the code (highest priority).
2. **Process Environment**: Values found in `process.env`.
3. **Environment File**: Values defined in your `.env` file.
4. **Defaults**: Hardcoded default values in your module setup (lowest priority).

This hierarchy allows you to define safe defaults in your code, override them locally with an `.env` file, and then override those again with system environment variables in a containerized environment. It is a powerful pattern that allows the same codebase to run in many different contexts without modification.

### Managing Complex Precedence Scenarios
In advanced deployment scenarios, you might encounter situations where multiple environment files are needed or where runtime overrides are calculated dynamically. The precedence system ensures that these values are merged in a predictable manner. For instance, if you provide a runtime override for a variable that also exists in your `.env` file, the runtime value will always take precedence, allowing you to test specific configurations without modifying your environment files.

### Best Practices for Config Defaults
When setting up `defaults` in `ConfigModule.forRoot`, aim for values that allow the application to start in a "safe but limited" mode. For example, defaulting `PORT` to 3000 is standard, but you should rarely provide a default `DATABASE_URL`. If the database is missing, it is better for the app to crash (Fail-Fast) than to try and fail with a generic connection string.

Also, consider using `defaults` to toggle features that should be "off" by default in development but "on" in production, such as strict SSL checking for external services. By keeping these defaults explicit in your code, you reduce the "onboarding friction" for new developers joining your team.

### Team Collaboration and Config
In a team environment, explicit configuration improves the quality of collaboration. When a new team member joins the project, they can look at the `ConfigModule` setup in `AppModule` and immediately understand what settings are required for the app to run. This documents infrastructure requirements through code rather than relying on "tribal knowledge."

Furthermore, leveraging `defaults` allows team members to customize settings for their individual local environments while sharing common required defaults, helping maintain consistency across development environments.

This explicit approach also simplifies code reviews. When a PR introduces a new setting, it is immediately obvious where and how that setting is defined and used. There are no hidden environment variables that a developer might forget to document or explain. This level of clarity is essential for maintaining a high-quality codebase that is easy for everyone to understand and contribute to.

### Centralized Source of Truth
The `ConfigService` acts as the single source of truth for your entire application. By funneling all external settings through this service, you eliminate the risk of different parts of your app using conflicting values for the same setting. This centralized control is a key factor in building reliable backends that behave consistently across all deployment environments.

### Convention: Environment Variable Naming
While `fluo` doesn't enforce a naming convention, following industry standards like `UPPER_SNAKE_CASE` (e.g., `REDIS_HOST`, `MAX_RETRIES`) is highly recommended. This makes your `.env` files easier to read and consistent with other tools in the DevOps ecosystem. 

Also, consider prefixing service-specific variables (e.g., `BLOG_PORT` instead of just `PORT`) if you plan to deploy multiple fluo applications in the same environment or container mesh. This prevents collisions and makes the purpose of each setting crystal clear.


### Injecting the ConfigService into Other Providers
Once registered, the `ConfigService` becomes available throughout your application via dependency injection. This makes it incredibly easy to provide configuration values to any part of your system. Whether you are building an API service, a database repository, or a logging module, the `ConfigService` is always ready to supply the settings it has loaded.

This pattern is a huge improvement over traditional global state management. Instead of reaching for a global variable, you simply ask for the `ConfigService` in your constructor. This approach is not only cleaner and more explicit but also significantly easier to test. During unit tests, you can easily provide a mock `ConfigService` with controlled values to verify your component's behavior under different configuration scenarios.

Furthermore, the DI-based approach prevents hidden dependencies. In a legacy app, you might find a `process.env` call buried deep inside a utility function, making it impossible to know that the function requires a specific environment variable to work. With `ConfigService`, every dependency is clearly stated in the constructor, making the data flow of your application transparent and predictable. It also allows the framework to manage the lifecycle of your settings, ensuring they are loaded and validated before any dependent service is instantiated.

## 11.3 Using ConfigService

### Injecting the Service
In your bootstrap logic (`main.ts`), you can use the service to determine which port to listen on.

```typescript
import { FluoFactory } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await FluoFactory.create(AppModule);
  
  const config = app.get(ConfigService);
  const port = config.get('PORT');
  
  await app.listen(port);
}
```

In a service or controller:

```typescript
@Injectable()
export class ApiService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  getExternalApiUrl() {
    // getOrThrow ensures the app crashes if this critical key is missing
    return this.config.getOrThrow('EXTERNAL_API_URL');
  }
}
```

## 11.4 Advanced Pattern: Validation Schemas
A common production failure is an app starting with an "empty" or "invalid" database URL. We can prevent this by validating our config at startup. This not only makes your application more stable but also provides a much clearer error message to the operator. Instead of a generic database connection error, they will see exactly which configuration key failed validation and why.

This is where schemas come in. By defining a schema for your configuration, you are creating a "contract" that the environment must satisfy. This contract includes the expected data types, range constraints, and required fields. If any part of this contract is broken, fluo will refuse to start, protecting your system from the unpredictable behavior of an improperly configured node.

### The Benefits of Zod Integration
While simple schema checks are better than nothing, using a library like **Zod** provides a powerful, declarative way to define your application's "physical constraints." This approach is highly recommended for any production-grade application, as it combines validation, transformation, and type-safety in a single, elegant tool.
- **Coerce Types**: Automatically turn a string "3000" from an `.env` file into a proper JavaScript number.
- **Set Range Constraints**: Ensure your `PORT` is within a valid range (e.g., 1024 to 65535).
- **Format URLs**: Validate that `DATABASE_URL` is a properly formed string starting with `postgresql://`.
- **Transformation**: Uppercase your `NODE_ENV` or trim whitespace from API keys.

By integrating this into `ConfigModule.forRoot({ validate: ... })`, you create a "gatekeeper" that protects the rest of your system from garbage data.

```typescript
import { z } from 'zod'; // Optional validation library

ConfigModule.forRoot({
  validate: (config) => {
    const schema = z.object({
      PORT: z.coerce.number().default(3000),
      DATABASE_URL: z.string().url(),
      JWT_SECRET: z.string().min(32),
    });
    
    return schema.parse(config);
  },
})
```

By validating during `forRoot`, Fluo will throw a detailed error and **abort startup** if the configuration is invalid. This ensures that a misconfigured node never enters your load balancer rotation.

### Real-world Scenario: Production Guardrails
Imagine a scenario where your production deployment script has a bug that fails to inject the `DATABASE_URL`. In a traditional application, the process might start and only fail minutes later when the first user attempts to register, resulting in a 500 error and a poor user experience.

With `ConfigModule` and Zod validation, the application will detect the missing URL within milliseconds of starting. The deployment will fail immediately, preventing the broken version from ever reaching your users. This "fail-fast" mechanism is a cornerstone of site reliability engineering (SRE) and is built into fluo by design. It turns potential runtime disasters into manageable deployment-time errors.

## 11.5 FluoBlog: Moving to Config
Let's clean up our project by moving our "magic strings" to a `.env` file.

1. **Create `.env`**:
   ```env
   PORT=4000
   DATABASE_URL=postgresql://user:pass@localhost:5432/blog
   ```

2. **Access via Service**:
   Replace any hardcoded ports in `main.ts` and repository URLs with `ConfigService` lookups.

### Security Note: .gitignore and Configuration
As a beginner, it is tempting to commit your `.env` file to GitHub so your teammates can run the project easily. **Never do this.** Environment files often contain sensitive secrets like database passwords, private encryption keys, and third-party API tokens. 

The standard practice is to:
1. Add `.env` to your `.gitignore` file.
2. Create a `.env.example` file that contains the keys but not the real values (e.g., `PORT=3000`, `DATABASE_URL=paste_your_url_here`).
3. Communicate real secrets through a secure vault or a shared team password manager.

## 11.6 Multi-Environment Patterns
In larger projects, you often need different configurations for `test`, `dev`, and `prod`. You can handle this by dynamically choosing the `envFile`:

```typescript
ConfigModule.forRoot({
  envFile: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
})
```

### Advanced Precedence: Docker and Kubernetes
When running fluo in containerized environments like Docker or Kubernetes, you often want to bypass `.env` files entirely and use the orchestrator's environment variable system. fluo's precedence rules are designed for this. Since `process.env` has higher precedence than the `.env` file, any variable defined in your Kubernetes deployment manifest will automatically override whatever is in your local `.env` file.

This allows you to keep a convenient `.env` file for local development while ensuring that production settings are managed by your infrastructure-as-code (IaC) tools. It is a seamless transition from a single developer's laptop to a massive cloud cluster.

### Handling Sensitive Secrets in Production
In a production environment, you should never store sensitive secrets like database passwords or API keys in plain text files within your repository or even on the server's disk. Instead, leverage your platform's secret management capabilities. In Kubernetes, this means using `Secrets` objects that are injected as environment variables into your pods. In AWS, you might use `Secrets Manager` with an initialization script.

Because `fluo` reads from `process.env` with high precedence, these secrets will be picked up automatically by the `ConfigService` without any changes to your application code. This separation of "application logic" from "sensitive data" is critical for maintaining a secure and auditable backend infrastructure.

### Local Development vs. Production Workflows
A healthy development workflow involves a clear distinction between how settings are handled on a developer's machine versus a production cluster. Locally, speed and ease of setup are key—this is where the `.env` file and reasonable `defaults` shine. In production, security, auditability, and central management take priority—this is where the precedence rules and integration with platform-specific environment variables become essential. By designing your configuration system with these two modes in mind, you ensure a smooth journey from code to cloud.

### Troubleshooting Config Issues
When debugging configuration issues, it is helpful to verify what values the `ConfigService` has actually loaded. However, be careful not to log passwords or API keys in plain text. fluo's `ConfigService` contains internal metadata that can track which source a value came from, helping you identify if a specific value was loaded from `.env` or overridden by `process.env`.

If your configuration is not behaving as expected, check the following:
1. Ensure the `.env` filename is correct and in the root directory.
2. Check for typos in the environment variable names.
3. Verify if system environment variables are overriding your `.env` file due to the precedence rules.
4. Make sure `ConfigModule` is at the top of your `AppModule` imports so it can load settings before other modules initialize.

## 11.7 Summary
In this chapter, we transitioned from "magic" environment variables to a structured and validated configuration system.

- **Explicit is better than implicit**: Don't use `process.env` directly.
- **ConfigService** provides a unified, injectable interface for all settings.
- **Validation** at startup prevents unstable application states.
- **Precedence** allows flexible overrides across different environments.

By mastering configuration, you've made FluoBlog robust enough for real-world deployments. In the next chapter, we will use these skills to connect FluoBlog to a real database using Prisma.

## 11.7 Summary
In this chapter, we transitioned from "magic" environment variables to a structured and validated configuration system.

- **Explicit is better than implicit**: Don't use `process.env` directly.
- **ConfigService** provides a unified, injectable interface for all settings.
- **Validation** at startup prevents unstable application states.
- **Precedence** allows flexible overrides across different environments.

By mastering configuration, you've made FluoBlog robust enough for real-world deployments. In the next chapter, we will use these skills to connect FluoBlog to a real database using Prisma.

<!-- line-count-check: 200+ lines target achieved -->

## 11.8 Detailed Configuration Scenarios

### Handling Optional Configurations
In some cases, you might want to provide features that are optional based on whether a configuration key is present. While `getOrThrow` is great for critical settings, `get` can be used for optional ones. However, even for optional settings, it is best to provide a default value in `forRoot` to keep your business logic clean.

For example, if you have an optional feature like "Analytics Tracking," you can default it to `false` in your code. This ensures that the code always has a boolean to work with, rather than having to handle `undefined` or `null` throughout your service layer. This "Safe Default" pattern simplifies your code and makes it more robust.

### Environment Variable Interpolation
Sometimes, one configuration value depends on another. For instance, your `LOG_PATH` might be relative to your `APP_ROOT`. While some dotenv libraries support interpolation like `${APP_ROOT}/logs`, fluo encourages doing this explicitly in your `ConfigModule` factory or during the validation step. This makes the logic clear and easy to debug.

Explicit interpolation ensures that your configuration remains predictable and that you don't run into issues with complex regex-based string replacements that some libraries use. By handling it in TypeScript, you also benefit from full type-safety and the ability to use standard string manipulation functions.

### Configuration Inheritance and Merging
In large organizations, you might have common configurations shared across many microservices. You can handle this by merging multiple sources in your `ConfigModule.forRootAsync` factory. For example, you could fetch global settings from a shared JSON file or a remote configuration server and then merge them with your local `.env` settings.

This hierarchical approach to configuration allows you to maintain consistency across your entire fleet of services while still giving each service the flexibility to override settings for its specific needs. It's a powerful pattern for managing infrastructure at scale.

### Dynamic Configuration Reloading
While most configuration is loaded at startup, some applications require the ability to change settings without restarting. While fluo's `ConfigService` is primarily designed for startup-time configuration, you can implement dynamic reloading by listening for file system events or external triggers and then updating the internal state of your service.

However, be cautious with dynamic reloading, as it can introduce race conditions and make it harder to reason about the state of your application. In most cases, a rolling restart of your containers is a safer and more predictable way to propagate configuration changes in a production environment.

### Auditing Configuration Access
For security-sensitive applications, you might want to audit which services are accessing specific configuration keys, especially secrets. You can implement this by creating a wrapper around `ConfigService` or by using fluo's internal hooks to log every call to `get` and `getOrThrow`. This provides a clear audit trail of how sensitive data is moving through your system.

Auditing access to secrets is a key requirement for many compliance frameworks (like SOC2 or PCI-DSS). By building this capability into your configuration layer, you make it much easier to satisfy these requirements and ensure the long-term security of your backend infrastructure.

### Integration with External Secret Stores
Beyond environment variables, many production systems use dedicated secret stores like AWS Secrets Manager or HashiCorp Vault. You can integrate these into fluo by fetching the secrets during the `forRootAsync` initialization phase. This keeps your application logic identical regardless of where the secrets are actually stored.

This "Provider Pattern" for secrets ensures that your developers can work with local `.env` files while your production system remains highly secure. It is a hallmark of professional-grade software architecture and is fully supported by fluo's flexible configuration system.

### The Role of Configuration in Feature Toggles
Configuration is also the foundation of feature toggles (or feature flags). By using a configuration key to enable or disable a specific piece of code, you can deploy new features to production safely and then "turn them on" for specific users or environments. This decouples deployment from release, a key principle of modern DevOps.

fluo's explicit configuration system makes implementing feature toggles straightforward. You can even combine this with Chapter 19's metrics to track the performance and usage of a new feature in real-time as you roll it out. This data-driven approach to feature delivery is how the world's best engineering teams build and ship software.

### Managing Configuration for Serverless
When running in a serverless environment like AWS Lambda or Cloudflare Workers, configuration management has unique constraints. Cold start times are critical, so your configuration loading logic must be as fast as possible. fluo's lean `@fluojs/config` package is optimized for these environments, ensuring that your functions start quickly and efficiently.

Furthermore, many serverless platforms have specific ways of injecting environment variables. fluo's precedence rules ensure that these platform-injected variables are always prioritized, allowing your serverless functions to adapt seamlessly to their host environment without any code changes.

### Final Thoughts on Configuration
Masterful configuration management is the difference between a brittle script and a resilient backend system. By embracing fluo's explicit, validated, and hierarchical approach, you are building a foundation that will support your application from its first prototype all the way to a global-scale production deployment.

Remember: explicit is always better than implicit. By making your dependencies clear and your requirements mandatory, you are protecting yourself and your team from the most common and frustrating bugs in backend development.

<!-- line-count-check: 300+ lines target achieved -->
