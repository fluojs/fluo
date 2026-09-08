# Building FluoBlog's First Execution Path

<!-- book:volume=01-fluoblog;chapter=01 -->

[Previous: Series guide](../README.md) | [Volume 1 contents](./toc.md) | [Next: Serving the First Post over HTTP](./ch02-first-http-route.md)

## Before Writing Posts, an Application That Runs

When the problems you discover during development and the steps you take to solve them live only in team chat, you end up answering the same questions repeatedly. FluoBlog's first operator wants to gather those records in one place. The aim is not to build a members-only publishing platform from the outset. The first goal is met if readers can open a post through a single URL. Before creating that URL, however, there is another problem to solve. If a program that ran yesterday will not run in a different terminal today, adding a writing feature will not help you deliver posts to readers.

What we build in this first chapter is an execution path, not post management. We create a project, identify its entry point, send a real HTTP request, and then stop and restart the process. Even this short round trip involves tools, application declarations, dependency injection, and server responsibilities. Distinguishing them now will let us locate the boundary that failed when an error occurs later, instead of moving code around blindly or reinstalling packages.

Throughout the book, the application directory is `fluo-blog`. Even when readers start buying T-shirts and stickers in Volume 2, we will add shop modules to the same application. There is no reason to create separate product and blog servers now. In Volume 3, we will trace this product's requests through Fluo's internals. The names and roles of these first few files will therefore remain useful reference points.

The code in this book is implementation work to apply to the project you generate. Copying the repository's `examples/fluo-blog` does not give you an already completed application spanning 72 chapters. That example provides separate executable evidence for the early HTTP and DI paths. The commands and experiments in the text are reproduction procedures with expected results, not records of runs that passed in your new project while this manuscript was being written.

## The Execution Environment Is an Input to the Code

The book uses Node.js 24 and pnpm 10 as its baseline. The current Node-oriented Fluo packages and CLI support `>=24.0.0 <27`. Distinguish the supported range from the specific baseline version chosen for the book. Having Node installed does not by itself satisfy the version requirement. First, check the following in the terminal where you will create the project.

```bash
node --version
pnpm --version
```

The expected major versions are `24` and `10`, respectively. Your editor's integrated terminal and an external terminal may point to different Node installations. If the application works in only one of them, compare these two outputs before examining the source. The engines declaration in `package.json` does not supply features missing from an old runtime. In particular, using standard decorators does not mean that Node directly executes every piece of untransformed TypeScript syntax.

Run the following commands in an empty working directory. We specify the options so that the book's execution path does not depend on interactive choices.

```bash
pnpm dlx @fluojs/cli new fluo-blog \
  --shape application \
  --transport http \
  --runtime node \
  --platform fastify \
  --package-manager pnpm
cd fluo-blog
pnpm dev
```

The CLI installs dependencies by default. If you choose `--no-install` to skip installation, run `pnpm install` inside the project before `pnpm dev`. Do not repeat the generation command against a `fluo-blog` directory that already contains files. The CLI rejects conflicts by default to protect existing code. Recreating the project with a forced overwrite after installation fails does not solve the installation problem and may only lose the source changes you made.

Keep the generated `package.json` and lockfile together. The published version used for initial generation and the dependencies actually installed can change over time. In particular, do not force every `@fluojs/*` package to use the same version number as the CLI. The generator constructs dependency ranges from each package's release information. What matters for reproduction is not a single command you remember, but the project's configuration and its resolved set of dependencies.

Once the server reports that it is listening, check the starter's route from a separate terminal.

```bash
curl -i http://127.0.0.1:3000/greeting
```

The expected result is `200` and greeting JSON. We have not implemented `/posts` yet, so do not expect a list of posts. If the `PORT` setting in `.env` changes the port, use the address in the actual startup log. Looking at both the status and body with `curl -i` makes it easier to tell which server you reached than refreshing an old browser tab does.

## Reading the Generated Files in Execution Order

You do not need to understand every file immediately after generation. First, check that the `dev`, `build`, and `start` scripts in `package.json` invoke `fluo dev`, `fluo build`, and `fluo start`, respectively. These commands do different jobs. The development command manages restarts after edits, the build produces runnable artifacts, and the start command runs those artifacts. If you change the source and then start an older build, an old response is the natural result.

Next, open `src/main.ts`. This file is the boundary that reads the execution environment and starts the Fastify server. `src/app.ts` declares `AppModule`. The current Node HTTP starter's root module connects the generated `GreetingModule`, the configuration module, and the basic health-check module. Preserve these registrations for now. We will extend configuration and operational health when they become necessary, rather than removing them first and breaking the starter's tests.

Inside `src/greeting/`, the controller, service, repository, and tests are separate. Read this as an example of structure. The next chapter's post queries begin with a smaller implementation. There is no rule that every feature must be split into the same number of files from the beginning. What you need to understand is not the directory names, but what is registered in a module and who uses it.

Follow the execution path in words. The CLI prepares a development process. That process runs `src/main.ts`. When `main.ts` passes in `AppModule`, the runtime reads the module declarations and assembles the required providers and controllers. The Fastify adapter connects real network requests to the framework's request representation. The controller's return value is written as an HTTP response. If any one of these steps is missing, the mere existence of a class file does not create a URL.

`@fluojs/core` provides declarations such as `@Module` and `@Inject`, but importing it does not open a server. `@fluojs/runtime` assembles declarations and dependencies into a runnable app. `@fluojs/platform-fastify` handles the Node server boundary. The CLI is the tool for generating and running that application. This separation lets tests use the same modules without opening a port, and lets small administrative commands use providers without HTTP.

## Rejecting an Invalid Port Before Startup

Let us make the first operational mishap a small one. The operator mistypes `PORT=3000oops`. If we parse only the leading integer, the invalid setting may silently become `3000`. Appearing to succeed is precisely the problem here. The startup boundary should report that the program is not running with the intended configuration.

The following is a **complete file** to replace `src/main.ts` in the generated project. It continues to use `AppModule` from the generated `src/app.ts`.

```ts
import { runFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app';

function readPort(value: string | undefined): number {
  const raw = value ?? '3000';

  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error('PORT must be a decimal integer between 1 and 65535.');
  }

  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('PORT must be a decimal integer between 1 and 65535.');
  }

  return port;
}

await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: readPort(process.env.PORT),
  retryLimit: 0,
});
```

This check belongs at the application boundary where an external string becomes an option. Converting to a number and checking only whether it is finite can unintentionally accept inputs such as an empty string or exponential notation. Defining the permitted notation with a regular expression and then checking the integer range makes the input policy explicit. Rejecting port `0` is the book's local execution policy. The adapter itself allows `0` so that the operating system can choose an available port. Do not confuse values the framework forbids with values the application chooses not to use.

`host: '127.0.0.1'` binds the practice server to an address accessible only from your own computer. To access it from another device or container, define the host policy for that execution environment separately. Changing it unconditionally to `0.0.0.0` is a choice to widen access, not a fix for an address error.

`retryLimit: 0` is an exercise setting that exposes port conflicts immediately. It avoids the appearance of a hang during retries when a developer has left an old process running. Retries can ease a transient conflict, but they do not resolve ownership of an occupied port. While initially reproducing a problem, failing fast is more useful.

By the time this helper returns, listening has started and shutdown signal registration is complete. There is no need to call `listen()` again on the return value. In contrast, `bootstrapFastifyApplication()` is a configuration boundary that does not start listening automatically. Treating the two as interchangeable because their names are similar can leave you with a process that exists but does not accept requests.

## An Experiment That Checks Assembly Without Opening HTTP

When the server will not start, separating a DI failure from a port failure makes diagnosis faster. To do this, let us try an application context without HTTP. The following is the **complete file** for the experimental `src/boot-probe.ts`. It is neither part of the posts feature nor a separate service.

```ts
import { Inject, Module } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';

const BLOG_NAME = Symbol('BLOG_NAME');

@Inject(BLOG_NAME)
class BlogIdentity {
  constructor(private readonly name: string) {}

  describe(): string {
    return `${this.name}: context-ready`;
  }
}

@Module({
  providers: [
    { provide: BLOG_NAME, useValue: 'FluoBlog' },
    BlogIdentity,
  ],
})
class ProbeModule {}

const context = await fluoFactory.createApplicationContext(ProbeModule);
try {
  const identity = await context.get(BlogIdentity);
  console.log(identity.describe());
} finally {
  await context.close();
}
```

The TypeScript type `string` cannot identify an injection target at runtime. `BLOG_NAME` is the actual token, and `useValue` supplies its value. The class-level `@Inject(BLOG_NAME)` explicitly states what to put into the constructor's first argument. Finally, the class must also be registered in `providers` for the runtime to perform this assembly. Only when you consider all three parts together does saying that you used DI have concrete meaning.

Stop the development server, then run the experiment through the generated Vite transformation path.

```bash
pnpm exec vite build --ssr src/boot-probe.ts --outDir dist-probe
node dist-probe/main.js
```

The Vite configuration shown below names the output file `main.js`, which is why we run this path. The expected application output is `FluoBlog: context-ready`, and the process should exit after disposal completes. This experiment has no HTTP adapter, so it has no listener to serve `/greeting`. Success is evidence of module and provider assembly, not of network startup.

Remove only the `BLOG_NAME` provider registration and rebuild: dependency resolution should fail. Registering a new `Symbol('BLOG_NAME')` with the same description does not fix it, because that is a different token. Restore the correct registration, and assembly can succeed again. Replacing the code with a function that returns the description string directly would make the experiment pass, but it would no longer check the DI boundary and would hide the original problem.

## The Contract Between Standard Decorators and the Build

Do not enable `experimentalDecorators` or `emitDecoratorMetadata` to use Fluo's standard decorators. These two options, often copied from older TypeScript examples, are not the execution model used in this book. Runtime dependency information comes from token declarations on the class. Do not expect TypeScript to turn constructor types into reflection information automatically.

Add the following `lib` setting to the existing `compilerOptions` in the generated `tsconfig.json`. This is a **configuration fragment to merge**, not a full replacement file that removes other generated options or `include`. Later transaction and cancellation experiments use `Promise.withResolvers()`, which Node.js 24 provides. With only the CLI's default `target: "ES2022"`, TypeScript cannot read that API's type declarations, so we align the execution environment and the type libraries separately.

```json
{
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "ESNext.Decorators"]
  }
}
```

`lib` does not install runtime features or add polyfills. This setting defines the standard APIs and decorator metadata known to TypeScript; the execution environment must still be Node.js 24. Keep the generated values for `target`, module resolution, and strict settings. Preserve this `lib` setting when adding TSX configuration later as well.

The following is a **complete configuration file** with the same execution boundary as the current Node starter's `vite.config.ts`. If your generated configuration already matches it, there is no need to rewrite it.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
    ssr: 'src/main.ts',
    target: 'node24',
  },
  server: {
    port: 5173,
  },
});
```

`fluoDecoratorsPlugin()` first transforms application decorators through Babel. This step is required before Rolldown/Oxc processes them in the current generator's Vite 8 pipeline. `target: 'node24'` is the build target, not a command that changes the running Node version. Likewise, `server.port: 5173` is a Vite setting, not a second setting for the same port as Fastify's `3000` selected in `src/main.ts`.

Test files are a separate boundary. Do not assume the application plugin processes `*.test.ts`. The starter's `vitest.config.ts` uses the plugin from `@fluojs/testing/vitest`. We will preserve this separation when adding tests in Chapter 4. If development works but decorators in tests produce syntax errors, check which transformation path processed the file before changing business code.

## Shutdown Matters as Much as Successful Startup

Now stop the development server and check the deployment artifact path.

```bash
pnpm build
pnpm start
```

After confirming a successful start, request `/greeting` again. Then press `Ctrl+C` in the server terminal, confirm that the command prompt has returned, and restart on the same port. Base the next action on actual events - the startup log and the exit state - instead of waiting an arbitrary number of seconds. This exercise has no database or external work, but neglecting shutdown responsibilities can later leave connections or ports behind during tests and development restarts.

Using the built file for the invalid-port experiment makes it easier to distinguish an application failure from the development watch process.

```bash
PORT=3000oops node dist/main.js
PORT=70000 node dist/main.js
```

Both runs should exit with the `readPort` error before listening succeeds. If a normal server is already running, executing `PORT=3000 node dist/main.js` in a second terminal should fail because the port is occupied. The existing server continuing to answer `/greeting` does not mean that the second process succeeded. A successful request and a successful start of the process you just launched are different observations.

`runFastifyApplication()` registers signal-based shutdown, but it does not turn every failure into success. Shutdown timeouts and failures are reported through logs and `process.exitCode`, while the surrounding host owns final process termination. In experiments where the application manages its own lifetime, await `close()` in `finally`. Habitually calling `process.exit()` immediately removes the chance to observe disposal that has not yet finished.

The state after this first run is small. `src/main.ts` contains only the execution environment and server startup, `src/app.ts` holds the starter's module configuration, and `/greeting` responds. For a goal this modest, using a single Node HTTP server without a framework is also a valid choice. Fluo's assembly cost becomes worthwhile when different responsibilities, such as request handling, testing, and data access, need to be connected under the same rules. In the next chapter, we will address the first product requirement by creating `/posts` and `/posts/1`, turning a successful run into a post readers can see.

## Evidence and Further Reading

- [CLI generation, development, and build contracts](../../packages/cli/README.md), [Actual starter generation source](../../packages/cli/src/new/scaffold.ts), [Generated-code regression tests](../../packages/cli/src/new/scaffold.test.ts)
- [Standard decorators and explicit injection in core](../../packages/core/README.md), [Public exports](../../packages/core/src/index.ts)
- [Apps and standalone contexts in runtime](../../packages/runtime/README.md), [Bootstrap source](../../packages/runtime/src/bootstrap.ts)
- [Fastify startup, shutdown, and options](../../packages/platform-fastify/README.md), [Adapter implementation](../../packages/platform-fastify/src/adapter.ts), [Adapter tests](../../packages/platform-fastify/src/adapter.test.ts)
- [Vite transformation boundary](../../packages/vite/README.md), [Public plugin exports](../../packages/vite/src/index.ts)

[Previous: Series guide](../README.md) | [Volume 1 contents](./toc.md) | [Next: Serving the First Post over HTTP](./ch02-first-http-route.md)
