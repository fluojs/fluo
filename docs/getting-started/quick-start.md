# quick start

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>

Experience the power of **standard decorators** and **explicit dependency injection** in under a minute. No legacy compiler flags, no magic reflection—just clean, verifiable TypeScript.

### who this is for
Developers who want to move beyond legacy decorators and see a modern, high-performance TypeScript framework in action.

### 1. install the CLI
The Konekti CLI is your central tool for project scaffolding and component generation.

```sh
pnpm add -g @konekti/cli
```

### 2. create your first project
Initialize a fresh application. By default, this bootstraps a high-performance **Fastify** adapter on Node.js.

```sh
konekti new my-konekti-app
cd my-konekti-app
```

### 3. start development
Konekti's starter comes with a pre-configured development environment that handles TypeScript compilation and process restarts automatically.

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
Konekti works with **standard TypeScript defaults**. You get full IDE support and type safety without the "experimental" baggage of the past decade.

### next steps
- **Build something real**: Follow the [First Feature Path](./first-feature-path.md) to add your own logic.
- **Master the CLI**: Learn how to generate entire feature slices with the [Generator Workflow](./generator-workflow.md).
- **Go beyond Node.js**: Check out [Bootstrap Paths](./bootstrap-paths.md) for Bun, Deno, and Edge runtimes.
