# Running the Same Code in Different Environments

<!-- book:volume=01-fluoblog;chapter=09 -->

[Previous: Building an API Contract Users Can Understand](./ch08-api-contracts.md) - [Volume 1 Contents](./toc.md) - [Next: Moving Posts from Memory to the Database](./ch10-prisma-persistence.md)

## Three Lines to Change on Every Deployment

FluoBlog's posts API now has clearly defined request and response shapes. But a colleague running it on another computer sends back a strange link. The post URL is still `http://localhost:3000/posts/1`, and the server is listening on the developer's port instead of the port assigned by the deployment platform. To fix this, the operator changes strings in `src/main.ts` and the link generation service. Back in the development environment, the production address now appears in local responses.

Solving differences in where the same code runs by editing the source undermines the meaning of the build artifact. The artifact you verified is no longer the one you actually deploy, and it becomes difficult to tell whether a failure comes from configuration or code. Once we add a database in the next chapter, this mistake can go beyond a bad link to writing posts into the wrong database. This chapter's goal is not to eliminate environments, but to give them a single entry point into the application.

The chapter extends the `fluo-blog` you created with the CLI. We use Node.js 24 and pnpm 10, retaining the build configuration from the previous chapters that transforms standard decorators. The repository's `examples/fluo-blog` provides runnable evidence for the early HTTP and DI work; it is not a finished application that already contains the configuration and database files we will define here. When a listing below is labeled a complete file, it means the entire file you should create in your application.

## Reading Strings and Deciding Configuration

The first fix that comes to mind is reading `process.env.PORT` or `process.env.PUBLIC_ORIGIN` wherever it is needed. But an environment variable is a string or `undefined`. In JavaScript, `"false"` is truthy, `Number('')` is `0`, and `parseInt('3000oops', 10)` returns `3000`. Converting a string to a number does not, by itself, make it valid configuration.

Defaults can conflict when each consumer chooses its own. The HTTP startup code might choose port `3000`, while the post link code chooses `8080`. If a test changes `process.env` while it runs, only services created later may read the new configuration. We therefore determine configuration in this order: **collect inputs, merge by precedence, validate and transform, then provide read-only access**. Domain services should know only the last step.

In this flow, `@fluojs/config` handles file loading, merging, synchronous validation, and providing `ConfigService`. It does not automatically collect every environment variable. The application must explicitly list the allowed keys in `processEnv`. From lowest to highest, precedence is `defaults`, env files, explicit `processEnv`, and `runtimeOverrides`. When there are multiple env files, later files in `envFilePaths` override earlier ones.

This order is an operational contract. A `DATABASE_URL` injected by the deployment system must take precedence over a developer's `.env.local`, and inputs supplied by a test must not be contaminated by the machine's real environment variables. Conversely, if a development database address remains in `runtimeOverrides`, which has the highest precedence, changing deployment environment variables will never override it. Before repeatedly restarting the service under the assumption that this is a configuration cache problem, check source precedence.

## Defining the Values FluoBlog Accepts

This chapter accepts only three keys: the HTTP port, the public address, and the database address. The public address is the base for post links, not the address to which the server actually binds. Behind a reverse proxy, the internal port may be `3000` while the public address is `https://blog.example.test`. Do not force one of these settings to be derived from the other.

Run the following command in your `fluo-blog` directory to add the required direct dependencies. Installing `@fluojs/runtime` does not guarantee that `@fluojs/config` is an application dependency.

```bash
pnpm add @fluojs/config zod@^4
```

The following is the complete `src/config/blog-config.ts` file. The Zod schema is passed to the `schema` option as a synchronous Standard Schema. This schema does not check whether PostgreSQL is reachable. It validates the structure of the address; Prisma initialization in the next chapter is responsible for the actual connection.

```ts
import type { ConfigModuleOptions, ConfigProcessEnv } from '@fluojs/config';
import { z } from 'zod';

const PortSchema = z.string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const PublicOriginSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:')
    && url.username === ''
    && url.password === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === '';
}).transform((value) => new URL(value).origin);

const DatabaseUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === 'postgresql:' || url.protocol === 'postgres:')
    && url.hostname.length > 0
    && url.pathname.length > 1;
});

export const BlogConfigSchema = z.object({
  PORT: PortSchema,
  PUBLIC_ORIGIN: PublicOriginSchema,
  DATABASE_URL: DatabaseUrlSchema,
});

export type BlogConfig = z.infer<typeof BlogConfigSchema>;

export function blogConfigOptions(
  env: ConfigProcessEnv,
  envFilePaths: readonly string[],
): ConfigModuleOptions {
  return {
    global: true,
    envFilePaths,
    defaults: { PORT: '3000' },
    processEnv: {
      PORT: env.PORT,
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      DATABASE_URL: env.DATABASE_URL,
    },
    schema: BlogConfigSchema,
  };
}
```

Restricting the port input to a string of decimal digits rejects empty strings, negative numbers, fractions, and `3000oops`. A range check after conversion is also necessary. The all-digit string `"999999"` must not be accepted as a valid TCP port. The public URL normalizes the trailing `/` but rejects deployment paths such as `/blog`, because FluoBlog at this stage is intended to be deployed at the site root. If you begin deploying under a subpath, do not just relax this condition: change routing and link generation together.

This `1..65535` range and string validation are FluoBlog policy. The schema does not reproduce the CLI-generated `Number.parseInt(..., 10)` and its `3000` fallback for a non-finite result. Fastify's numeric option also accepts port `0`, but this app does not use it. We are moving Chapter 1's small `readPort` into the configuration schema, not changing the CLI or adapter input contract.

The absence of a default for `DATABASE_URL` is deliberate as well. When the connection destination is unclear, stopping startup makes the cause easier to find than connecting to a development database. Even a URL accepted by the schema can have an incorrect password or an unavailable network. Syntactic validity, connectivity, and permission to perform the intended operations are separate checks.

The schema input for `PORT` is a string, and its output is a number. The type passed to `ConfigService<BlogConfig>` describes this output, not the input. Supplying a type argument does not create runtime validation. Here, the registration schema and the consumer's type come from the same definition so they stay aligned.

## Passing Registered Configuration through DI

The following is the complete `src/config/app-settings.ts` file. Its getters expose names that application services need. This keeps deployment-oriented names such as `DATABASE_URL` from spreading through every feature file. We do not build a large abstraction just to return configuration; we limit it to the three values currently needed.

```ts
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';
import type { BlogConfig } from './blog-config.js';

@Inject(ConfigService)
export class AppSettings {
  constructor(private readonly config: ConfigService<BlogConfig>) {}

  get port(): number {
    return this.config.getOrThrow('PORT');
  }

  get publicOrigin(): string {
    return this.config.getOrThrow('PUBLIC_ORIGIN');
  }

  get databaseUrl(): string {
    return this.config.getOrThrow('DATABASE_URL');
  }
}
```

The following is the complete `src/config/app-settings.module.ts` file. A class-level `@Inject(ConfigService)` does not create a provider by itself. `imports` brings in the configuration registration, `providers` creates `AppSettings`, and `exports` makes it available to other modules.

```ts
import { ConfigModule, loadConfig } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { AppSettings } from './app-settings.js';
import { blogConfigOptions, type BlogConfig } from './blog-config.js';

const envFiles = process.env.NODE_ENV === 'production'
  ? []
  : ['.env', '.env.local'];

export const blogConfig: Readonly<BlogConfig> = Object.freeze(
  loadConfig(blogConfigOptions(process.env, envFiles)) as BlogConfig,
);

const configRegistration = ConfigModule.forRoot({
  global: true,
  envFilePaths: [],
  runtimeOverrides: blogConfig,
});

@Module({
  global: true,
  imports: [configRegistration],
  providers: [AppSettings],
  exports: [AppSettings],
})
export class AppSettingsModule {}
```

The environment decision in this file is our chosen policy, not an automatic Fluo feature. With `NODE_ENV=production`, file input is disabled; other runs read the two files in the specified order. In CI, explicitly set `production` or pass an empty list to the function, as the unit tests do. `envFilePaths: []` also disables fallback to the default `.env`. When files are specified, relative paths are resolved from the startup directory, so always run development commands from the `fluo-blog` root.

Here, we expose the application's single configuration globally. `ConfigModule` already defaults to `global: true`, but we state it explicitly to make the composition intent clear. An application that isolates configuration per plugin can choose `global: false` and explicit module imports instead. Global exposure does not weaken type or value validation, but it makes dependencies less visible, so consuming classes must still use `@Inject`.

This time, we need the port before creating the adapter, so we validate once with `loadConfig` and register the result. The public return type of `loadConfig` is a general configuration dictionary. The `as BlogConfig` here does not replace input validation; it expresses the correspondence between the output of the `BlogConfigSchema` just executed and its type. Do not apply the same assertion to raw environment variables. We freeze the result, whose fields are all primitive values, and pass only this snapshot to DI so the files are not read twice. Nor do we apply a string-input schema again to a port that is already a number.

Registration and validation happen at different times. `ConfigModule.forRoot(...)` registers providers synchronously; in an ordinary schema registration, bootstrap loads configuration when resolving `ConfigService` and validates it synchronously before listen. Here, explicit `loadConfig(...)` runs while this module evaluates, so validation happens earlier. A schema failure is `INVALID_CONFIG`: the dynamic import below fails before reaching `runFastifyApplication`. Do not confuse this flow, which registers an already validated snapshot, with a claim that calling `forRoot` alone finishes file loading.

Import `AppSettingsModule` into the existing `AppModule` in `src/app.ts` and add it to `imports`. The following shows composition with the existing modules, not a file that replaces all HTTP configuration. `PostsModule` is the `src/posts/posts.module.ts` built in the previous chapters. Keep the generated greeting and health registrations and existing features, and compose the original config registration into this snapshot path rather than leaving a second configuration source that reads the same keys again.

```ts
import { Module } from '@fluojs/core';
import { AppSettingsModule } from './config/app-settings.module.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [AppSettingsModule, PostsModule],
})
export class AppModule {}
```

Now connect the actual startup port. The following is a minimal, complete `src/main.ts` using this configuration. If you added middleware or request handling options in earlier chapters, retain them in the same helper's options. The decorated application graph is imported dynamically after preparing the metadata symbol, so preparation does not happen too late for the response model decorators. Merely placing a static import below `ensureMetadataSymbol()` cannot establish this order: that import evaluates before the entrypoint body.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { ensureMetadataSymbol } from '@fluojs/core';
import { createFastifyAdapter } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({
    host: '127.0.0.1',
    port: blogConfig.PORT,
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

Configure the adapter passed to `FluoFactory.create()` with the already validated `blogConfig.PORT`. Awaiting `app.listen()` completes listening and the selected shutdown registration. Services read `AppSettings.port` from that same snapshot. Validation failure stops creation; injected configuration does not move a listener after startup.

Reading configuration through DI is not a reason to replace this code with `FluoFactory.create()` and `listen()`. With explicit composition, you also own listen, signals, and the helper's middleware, logger, and post-creation failure cleanup policies. The book keeps the default run helper together with the validated snapshot. The next chapter's `BlogDatabaseModule` uses the same `AppSettings.databaseUrl`, and later authentication settings extend this validation path. This is not a new starting point that rereads the environment separately for database and authentication settings or discards accumulated middleware and upload limits.

## Removing Environment Dependencies from Public Links

Let us go beyond registration code and use configuration to solve an actual problem. The following is the complete `src/posts/post-links.ts` file. It builds links by ID to match the existing `/posts/:id` contract. Creating a `slug` and exposing a slug-based HTTP route are not the same thing.

```ts
import { Inject } from '@fluojs/core';
import { AppSettings } from '../config/app-settings.js';

@Inject(AppSettings)
export class PostLinks {
  constructor(private readonly settings: AppSettings) {}

  detail(id: number): string {
    return new URL(`/posts/${id}`, this.settings.publicOrigin).href;
  }
}
```

Add `PostLinks` to `PostsModule.providers`, and have the existing service that assembles public responses receive it through `@Inject(PostLinks)`. Use the positive integer ID validated at the boundaries established in the earlier chapters. Do not use the request's `Host` header directly as the base for public links. A hostname sent by a user and the canonical address published by the operator belong to different trust boundaries.

We also define an example configuration file. The following is the complete content of `.env.example`; the connection address and credentials are examples for local exercises. Exclude the actual `.env` and `.env.local` files from version control. Adding an ignore rule does not remove an already tracked secret from history.

```dotenv
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://fluo:local_only@127.0.0.1:5432/fluo_blog
```

Do not verify configuration by printing it in full to production logs. A database URL can contain a username and password. Startup diagnostics can record the port, public origin, and whether configuration validation succeeded as separate facts. Also avoid returning an error's entire `cause` or the validator's issues in an external response. This separates secrets needed for the connection from facts needed for diagnosis rather than hiding the existence of an error.

## Tests Independent of the Machine's State

The following is the complete `test/config.test.ts` file. Writing this test first reveals that an implementation reading `process.env` directly at each point of use lacks the expected input isolation. The test itself does not change real environment variables, touch files, or depend on waiting. Run it with the Vitest configuration from the previous chapters.

```ts
import { ConfigService, loadConfig } from '@fluojs/config';
import { describe, expect, it } from 'vitest';
import { blogConfigOptions } from '../src/config/blog-config.js';

const validEnv = {
  PUBLIC_ORIGIN: 'https://blog.example.test/',
  DATABASE_URL: 'postgresql://fluo:local_only@127.0.0.1:5432/fluo_blog',
};

describe('FluoBlog configuration', () => {
  it('transforms inputs and keeps only the explicit application keys', () => {
    const values = loadConfig(blogConfigOptions({
      ...validEnv,
      PORT: '4100',
      UNRELATED_SECRET: 'not-part-of-the-blog',
    }, []));

    expect(values).toEqual({
      PORT: 4100,
      PUBLIC_ORIGIN: 'https://blog.example.test',
      DATABASE_URL: validEnv.DATABASE_URL,
    });
  });

  it('does not let an absent process value erase the default', () => {
    const values = loadConfig(blogConfigOptions(validEnv, []));
    expect(values.PORT).toBe(3000);
  });

  it('applies explicit overrides above the environment', () => {
    const options = blogConfigOptions({ ...validEnv, PORT: '4100' }, []);
    const values = loadConfig({
      ...options,
      runtimeOverrides: { PORT: '4200' },
    });
    expect(values.PORT).toBe(4200);
  });

  it.each(['', '0', '-1', '3.5', '3000oops', '65536'])(
    'rejects invalid PORT %j',
    (PORT) => {
      expect(() => loadConfig(
        blogConfigOptions({ ...validEnv, PORT }, []),
      )).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    },
  );

  it('rejects a missing database and a public address with a path', () => {
    expect(() => loadConfig(blogConfigOptions({
      PUBLIC_ORIGIN: validEnv.PUBLIC_ORIGIN,
    }, []))).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));

    expect(() => loadConfig(blogConfigOptions({
      ...validEnv,
      PUBLIC_ORIGIN: 'https://blog.example.test/private',
    }, []))).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('returns detached object values', () => {
    const config = new ConfigService({ links: { origin: validEnv.PUBLIC_ORIGIN } });
    const links = config.getOrThrow('links');
    links.origin = 'https://changed.example.test';
    expect(config.getOrThrow('links.origin')).toBe(validEnv.PUBLIC_ORIGIN);
  });
});
```

```bash
pnpm exec vitest run test/config.test.ts
```

On success, observe numeric port conversion, normalization of the trailing `/`, the absence of unrelated keys, rejection through `INVALID_CONFIG`, and isolation from changes to returned objects. This chapter does not claim that these application-specific tests were run during writing. They are reproducible tests constructed from the package implementation and contract tests; run them after adding the files to your project.

To experiment with file precedence, set the local-only `.env` to `PORT=3100` and `.env.local` to `PORT=3200`, then start with process input `PORT=3300`. The expected value is `3300`; removing the process input makes it `3200`. Deleting the higher-priority file falls back to the lower-priority file, but if the required database URL is lost as well, startup failure is correct. In tests, do not confuse the existence of a file with the presence of every required value.

## Choosing Not to Make Configuration Mutable

Calling `ConfigService` read-only does not mean that every read returns a constant with the same reference. Object values are returned as detached clones, so changing an object you retrieved does not change the active snapshot. There is no need to retrieve a large configuration tree in full for every request. Reading only the leaf values you need reduces both copying cost and dependencies.

The package also supports reload and watch, but we do not enable them at this stage. Changing the database URL does not automatically move an existing Prisma connection to a new database. Changing the port does not move an open socket. Updating a configuration snapshot and recreating resources built from that configuration are separate operations. For now, configuration changes go through a restart that includes validation.

If you later want to refresh only UI feature flags, design reload by separating values that may change from values fixed at startup. A contract that restores the snapshot when a configuration listener fails does not guarantee that external work already performed is undone. There is also no registration API called `ConfigModule.forRootAsync()`. If you need an asynchronous secrets service, resolve it first in application-owned startup processing and pass the result to synchronous registration.

FluoBlog has now separated development and production addresses from source code. The next problem is that even in the correct environment, restarting still loses all posts. In the next chapter, we use `AppSettings.databaseUrl` to register a single PostgreSQL connection and persist the posts currently held in memory. The input boundary defined here will continue to apply when we later add merchandise features to this same blog.

## Canonical Docs

This chapter explains the Docs configuration and startup order through a single FluoBlog snapshot. Allowed URLs, strict ports, and env file selection are application policy, distinct from the registration API's defaults.

- [Documentation authority and the Book's role](../../docs/contracts/documentation-authority.md)
- [Configuration loading, precedence, and validation contracts](../../docs/architecture/config-and-environments.md)
- [Configuration validation, metadata preparation, and bootstrap boundaries](../../docs/getting-started/bootstrap-paths.md)

## Supporting Implementations and Contracts

- [Configuration package registration, precedence, and runtime environment contracts](../../packages/config/README.md)
- [Public exports](../../packages/config/src/index.ts) and [configuration option types](../../packages/config/src/types.ts)
- [File input, undefined-value removal, merging, and validation implementation](../../packages/config/src/load.ts)
- [Module registration and snapshot provision](../../packages/config/src/module.ts)
- [Read and clone implementation](../../packages/config/src/service.ts)
- [Contract tests for multiple env files, empty lists, and watch](../../packages/config/src/load-env-file-paths.test.ts)
- [Object and array merge contract tests](../../packages/config/src/load-merge-contract.test.ts)
- [Startup ordering contract for configuration snapshots and HTTP adapters](../../docs/getting-started/migrate-from-nestjs.md)
- [Fastify startup options and the `runFastifyApplication` implementation](../../packages/platform-fastify/src/adapter.ts)

[Previous: Building an API Contract Users Can Understand](./ch08-api-contracts.md) - [Volume 1 Contents](./toc.md) - [Next: Moving Posts from Memory to the Database](./ch10-prisma-persistence.md)
