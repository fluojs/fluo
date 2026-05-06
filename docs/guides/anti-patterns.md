# fluo Anti-Patterns

<p><strong><kbd>English</kbd></strong> <a href="./anti-patterns.ko.md"><kbd>한국어</kbd></a></p>

## Dependency Injection

### ❌ Anti-pattern

```ts
import { Injectable } from '@fluojs/core';

@Injectable()
export class PaymentsService {
  private readonly apiKey = process.env.PAYMENTS_API_KEY;

  constructor(private readonly orders: OrdersService) {}
}

@Injectable()
export class OrdersService {
  constructor(private readonly payments: PaymentsService) {}
}
```

### ✅ Correct

```ts
import { Inject, Injectable } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

@Inject(ConfigService, OrdersService)
@Injectable()
export class PaymentsService {
  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
  ) {}

  getApiKey(): string {
    return this.config.getOrThrow('PAYMENTS_API_KEY');
  }
}
```

## Decorators

### ❌ Anti-pattern

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

```ts
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

### ✅ Correct

```json
{
  "compilerOptions": {
    "experimentalDecorators": false
  }
}
```

```ts
import { Inject, Injectable } from '@fluojs/core';

@Inject(UsersRepository)
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

## Platform Adapters

### ❌ Anti-pattern

```ts
export class FastifyLikePlatform {
  listen(app: unknown) {
    if (process.versions.bun) {
      return Bun.serve({ fetch: () => new Response('ok') });
    }

    return app;
  }
}
```

### ✅ Correct

```ts
import type { Dispatcher, HttpApplicationAdapter } from '@fluojs/http';

export class FastifyPlatformAdapter implements HttpApplicationAdapter {
  #server: FastifyServer | undefined;

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.#server = await startFastifyServer(dispatcher);
  }

  async close(_signal?: string): Promise<void> {
    await this.#server?.close();
  }
}
```

## Package Authoring

### ❌ Anti-pattern

```ts
export function createJwtGuard(secret: string) {
  return new JwtGuard(secret);
}
```

```md
Release governance note

- changed `createJwtGuard(secret)` to `createJwtGuard(options)`
```

### ✅ Correct

```ts
/**
 * Creates a JWT guard from explicit options.
 */
export function createJwtGuard(options: JwtGuardOptions) {
  return new JwtGuard(options);
}
```

```md
Release governance note

- Major release required because the public constructor contract changed in `1.0+`.
```

## Testing

### ❌ Anti-pattern

```ts
describe('config loader', () => {
  it('reads from the real process env', () => {
    process.env.API_KEY = 'live-value';
    expect(loadApiKey()).toBe('live-value');
  });
});
```

```ts
const docsPath = '/Users/name/project/docs/contracts/behavioral-contract-policy.md';
```

### ✅ Correct

```ts
describe('config loader', () => {
  it('receives explicit config input', () => {
    const config = new ConfigService({ API_KEY: 'test-value' });
    expect(loadApiKey(config)).toBe('test-value');
  });
});
```

```ts
import { resolve } from 'node:path';

const docsPath = resolve(process.cwd(), 'docs/contracts/behavioral-contract-policy.md');
```
