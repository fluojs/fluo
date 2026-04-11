# quick start

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>

Experience the power of **standard decorators** and **explicit dependency injection** in under a minute. No legacy compiler flags, no magic reflection—just clean, verifiable TypeScript.

### who this is for
Developers who want to move beyond legacy decorators and see a modern, high-performance TypeScript framework in action.

### 1. install the CLI
The fluo CLI is your central tool for project scaffolding and component generation.

```sh
pnpm add -g @fluojs/cli
```

### 2. create your first project
Initialize a fresh application. By default, this bootstraps the v2 compatibility baseline: a high-performance **Fastify** HTTP adapter on Node.js.

```sh
fluo new my-fluo-app
cd my-fluo-app
```

If you want to select the same HTTP starter path explicitly, use the flags-first v2 contract:

```sh
fluo new my-fluo-app --shape application --transport http --runtime node --platform fastify
```

The same command family also exposes the other published v2 starter paths:

```sh
# Runnable TCP microservice starter
fluo new my-fluo-microservice --shape microservice --transport tcp --runtime node --platform none

# Mixed single-package starter: Fastify HTTP app + attached TCP microservice
fluo new my-fluo-mixed --shape mixed --transport tcp --runtime node --platform fastify
```

For a docs-level split between these published starter paths and the broader Express/Bun/Deno/Cloudflare ecosystem, see the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

When `fluo new` runs in an interactive terminal, the wizard resolves onto this same shape-first model. It asks for the project name, starter shape, the maintained tooling preset, package manager, whether to install dependencies, and whether to initialize git.

### 3. start development
fluo's starter comes with a pre-configured development environment that handles TypeScript compilation and process restarts automatically.

```sh
pnpm dev
```

### 4. verify and explore
Once the server is up (usually on port 3000), hit the built-in observability and sample endpoints:

- **Health Check**: `curl http://localhost:3000/health`  
  *Expect: `{"status":"ok"}`*
- **Sample Module**: `curl http://localhost:3000/health-info/`  
  *See the standard decorator pattern in action.*

### why this matters
Open `tsconfig.json` in your new project. Notice something?
```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```
fluo works with **standard TypeScript defaults**. You get full IDE support and type safety without the "experimental" baggage of the past decade.

### next steps
- **Build something real**: Follow the [First Feature Path](./first-feature-path.md) to add your own logic.
- **Master the CLI**: Learn how to generate entire feature slices with the [Generator Workflow](./generator-workflow.md).
- **Go beyond Node.js**: Check out [Bootstrap Paths](./bootstrap-paths.md) for Bun, Deno, and Edge runtimes.
- **Review the CLI contract**: See the [toolchain contract matrix](../reference/toolchain-contract-matrix.md) for the documented starter matrix.
