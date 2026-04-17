# quick start

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>

Experience the power of standard decorators and explicit dependency injection in under a minute. No legacy compiler flags, no magic reflection, just clean, verifiable TypeScript.

### who this is for
Developers who want to move beyond legacy decorators and see a modern, high-performance TypeScript framework in action.

### 1. install the CLI
The fluo CLI is your central tool for project scaffolding and component generation.

```sh
pnpm add -g @fluojs/cli
```

### 2. create your project
Initialize a fresh application. By default, this bootstraps a high-performance Fastify HTTP adapter on Node.js.

```sh
fluo new my-fluo-app
cd my-fluo-app
```

While the interactive wizard is the recommended path, you can also use explicit flags to select a specific starter.

| Shape | Transport | Runtime | Platform | Command |
| :--- | :--- | :--- | :--- | :--- |
| application | http | node | fastify | `fluo new app --platform fastify` |
| application | http | bun | bun | `fluo new app --runtime bun` |
| application | http | workers | workers | `fluo new app --runtime cloudflare-workers` |
| microservice | tcp | node | none | `fluo new svc --transport tcp` |
| microservice | nats | node | none | `fluo new svc --transport nats` |

For the full list of available configurations, see the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

### 3. start development
fluo's starter comes with a pre-configured development environment that handles TypeScript compilation and process restarts automatically.

```sh
pnpm dev
```

### 4. verify your setup
Once the server is up on port 3000, check the built-in observability and sample endpoints.

- **Health Check**: `curl http://localhost:3000/health`
  *Expect: {"status":"ok"}*
- **Greeting**: `curl http://localhost:3000/hello`
  *Expect: {"message":"Hello, World!"}*

### 5. understand your project
The generated project follows a modular structure designed for clarity and explicit dependencies.

```text
my-fluo-app/
├── src/
│   ├── main.ts            # application entry point
│   ├── app.ts             # root module definition
│   ├── hello.controller.ts # http route handler
│   └── hello.service.ts    # business logic provider
├── tsconfig.json          # standards-first configuration
└── package.json
```

#### main.ts: entry point
The entry point initializes the runtime with a chosen platform adapter and the root module.

```ts
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
```

#### app.ts: the root module
The `@Module` decorator defines the boundaries of your application. It aggregates controllers for routing and providers for logic.

```ts
import { Module } from '@fluojs/core';
import { createHealthModule } from '@fluojs/runtime';
import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [RuntimeHealthModule],
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
```

#### hello.controller.ts: handling requests
Controllers use `@Controller` and `@Get` decorators to map incoming requests to methods. Dependency injection is explicit through the `@Inject` decorator.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { HelloService } from './hello.service';

@Inject(HelloService)
@Controller('/hello')
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get('/')
  greet(): { message: string } {
    return this.helloService.greet('World');
  }
}
```

#### hello.service.ts: business logic
Services are plain classes that handle the heavy lifting. They are registered as providers in a module so they can be injected where needed.

```ts
export class HelloService {
  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` };
  }
}
```

### why this matters
Open `tsconfig.json` in your new project. You will notice that fluo works with standard TypeScript defaults.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```

By using TC39 standard decorators, you get full IDE support and type safety without relying on experimental legacy flags that deviate from the JavaScript language path.

### next steps
- **Build something real**: Follow the [First Feature Path](./first-feature-path.md) to add your own logic.
- **Master the CLI**: Learn how to generate entire feature slices with the [Generator Workflow](./generator-workflow.md).
- **Go beyond Node.js**: Check out [Bootstrap Paths](./bootstrap-paths.md) for Bun, Deno, and Edge runtimes.
- **Review the CLI contract**: See the [toolchain contract matrix](../reference/toolchain-contract-matrix.md) for the documented starter matrix.
