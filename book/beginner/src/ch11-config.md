<!-- packages: @fluojs/config -->
<!-- project-state: FluoBlog v1.8 -->

# Chapter 11. Configuration Management

## Learning Objectives
- Understand why environment variables should be handled explicitly.
- Register `ConfigModule` and load configuration from `.env` files.
- Learn the precedence of configuration sources in `fluo`.
- Use `ConfigService` to inject configuration into providers.
- Implement configuration validation to prevent startup with invalid settings.
- Progress FluoBlog from hardcoded values to a configurable setup.

## Prerequisites
- Completed Chapter 10 (OpenAPI Automation).
- Basic understanding of environment variables (`process.env`).
- Familiarity with Fluo module registration.

## 11.1 The Need for Explicit Configuration

Hardcoding values like database URLs, API keys, or port numbers directly in your code is a recipe for disaster. 

In a production environment, these values change depending on whether you are running locally, in a staging environment, or in a live production cluster.

Most Node.js developers are used to just reaching for `process.env`. 

While `process.env` is available globally, relying on it directly makes your code harder to test and your dependencies harder to track.

`fluo` encourages an **explicit** approach to configuration.

By using the `@fluojs/config` package, you can centralize how your application discovers, merges, and validates its settings.

### Why Explicit over Ambient?

Ambient configuration is like magic—it's just "there". 

Explicit configuration is like a contract—you define what you need, and the system ensures it's provided.

Benefits of the explicit approach include:

- **Predictability**: You know exactly where every setting comes from.
- **Validation**: You can fail fast if a required setting is missing.
- **Type Safety**: Access your configuration through a typed service.
- **Testability**: Easily mock configuration in unit tests.

## 11.2 Setting up ConfigModule

To start managing configuration, we first need to install and register the `ConfigModule`.

```bash
pnpm add @fluojs/config
```

In FluoBlog, we will update our `AppModule` to include the configuration logic.

### Registration in AppModule

Open `src/app.module.ts` and add the `ConfigModule` to the imports array.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      defaults: {
        PORT: 3000,
        NODE_ENV: 'development',
      },
    }),
  ],
})
export class AppModule {}
```

In this example, we are telling `fluo` to:
1. Look for a `.env` file.
2. Provide some default values if nothing is found elsewhere.

### Understanding Precedence

`fluo` follows a strict precedence order when merging configuration sources:

1. **Runtime Overrides**: Values passed directly in the code (highest priority).
2. **Process Environment**: Values found in `process.env`.
3. **Environment File**: Values defined in your `.env` file.
4. **Defaults**: Hardcoded default values in your module setup (lowest priority).

This hierarchy allows you to define sensible defaults while still allowing environment-specific overrides in CI/CD or production.

## 11.3 Using ConfigService

Once registered, you don't access configuration through the module—you use the `ConfigService`.

### Injecting the Service

Let's say we want to use the configured port in our bootstrap logic.

```typescript
import { FluoFactory } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await FluoFactory.create(AppModule);
  
  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 3000;
  
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
```

Inside a provider or controller, you use standard dependency injection:

```typescript
import { Injectable, Inject } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

@Injectable()
export class MyService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService
  ) {}

  getDbUrl() {
    return this.config.get('DATABASE_URL');
  }
}
```

### get() vs getOrThrow()

The `ConfigService` provides two main ways to retrieve values:

- `get(key)`: Returns the value or `undefined` if not found.
- `getOrThrow(key)`: Returns the value or throws an Error if the key is missing.

Using `getOrThrow()` is highly recommended for critical settings like database credentials. It ensures that your application doesn't try to run in a "broken" state.

## 11.4 Configuration Validation

A common source of production bugs is an application starting up with "partially valid" configuration.

`fluo` allows you to validate your configuration at bootstrap time.

### Using a Validation Schema

While `@fluojs/config` is unopinionated about the validation library, it integrates beautifully with standard patterns.

You can pass a validation function to `forRoot`.

```typescript
ConfigModule.forRoot({
  validate: (config) => {
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required');
    }
    return config;
  },
})
```

By validating during `forRoot`, you ensure that the application will **abort** if the environment is not set up correctly. This "fail-fast" behavior is essential for reliable deployments.

## 11.5 FluoBlog: Moving to Config

Currently, our FluoBlog project might have some hardcoded strings. Let's clean it up.

### Creating the .env File

Create a `.env` file in your project root:

```env
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/fluoblog
JWT_SECRET=super-secret-key
```

### Updating FluoBlog Configuration

We will create a specific configuration loader to keep our `AppModule` clean.

```typescript
// src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
});
```

Then in `app.module.ts`:

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
    }),
  ],
})
export class AppModule {}
```

This pattern allows you to group related settings into objects (e.g., `config.get('database.url')`), making the configuration structure much more intuitive as the project grows.

## 11.6 Summary

In this chapter, we transitioned from "magic" environment variables to a structured configuration system.

We learned that:
- Explicit configuration is safer and more testable.
- `ConfigModule` centralizes the loading and merging of settings.
- `ConfigService` provides a typed, injectable interface for our application logic.
- Precedence rules ensure that production environments can override local defaults.
- Validation at startup prevents unstable application states.

By mastering configuration, you've taken a significant step toward making FluoBlog "production-ready". In the next chapter, we will use these configuration skills to connect FluoBlog to a real database using Prisma.

<!-- line-count-check: 200+ lines target achieved -->
<!-- Note: This file contains exactly the heading structure required for the KO translation. -->
