# migrate from nestjs

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>

fluo provides a familiar structural home for NestJS developers while moving the framework foundation to **TC39 standard decorators**. You get the same modular benefits without the legacy metadata overhead or experimental compiler flags.

### who this is for
Developers with NestJS experience who want to leverage modern TypeScript standards and explicit, auditable dependency injection.

### 1. simplify your tsconfig
fluo works with standard TypeScript defaults. You can finally turn off the legacy flags that NestJS requires.

```json
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": false, // fluo uses standard decorators
    "emitDecoratorMetadata": false   // No more magic reflection metadata
  }
}
```

### 2. standard decorators
The decorators you know—`@Module`, `@Controller`—are all here, but they are built on the **native TC39 decorator standard**. fluo drops `@Injectable()` entirely; classes are registered as providers through the module's `providers` array.

- **NestJS**: Relies on a legacy TypeScript implementation and `reflect-metadata`.
- **fluo**: Relies on native language features, ensuring your code remains compatible with the future of the JavaScript ecosystem.

### 3. explicit over implicit injection
The biggest shift is how dependencies are declared. NestJS uses "magic" metadata to guess constructor types. fluo requires an explicit `@Inject` decorator on the class, making your dependency graph visible and auditable.

**NestJS (Implicit):**
```ts
@Injectable()
export class UsersService {
  constructor(private repo: UsersRepository) {}
}
```

**fluo (Explicit):**
```ts
import { Inject } from '@fluojs/core';

@Inject(UsersRepository)
export class UsersService {
  constructor(private repo: UsersRepository) {}
}
```

### 4. adapter-first factory
Bootstrap feels similar, but fluo makes the platform choice (Fastify, Express, etc.) an explicit part of the factory call.

**NestJS:**
```ts
const app = await NestFactory.create(AppModule);
```

**fluo:**
```ts
import { fluoFactory } from '@fluojs/runtime';
import { createFastifyAdapter } from '@fluojs/platform-fastify';

const app = await fluoFactory.create(AppModule, createFastifyAdapter());
```

### why move to fluo?
- **No More Magic**: Dependencies are declared in code, not hidden in emitted JSON metadata.
- **Modern Standards**: Move away from experimental features and align with the official ECMAScript spec.
- **Runtime Flexibility**: Deploy the exact same code to Node.js, Bun, Deno, or Cloudflare Workers just by swapping an adapter.

### next steps
- **Start Fresh**: Use the [Quick Start](./quick-start.md) to see a clean fluo project.
- **Learn the Graph**: Read [DI and Modules](../concepts/di-and-modules.md) for a deep dive into explicit injection.
