# fluo Anti-Patterns

<p><a href="./anti-patterns.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

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
import type { PlatformAdapter } from '@fluojs/runtime';

export class FastifyPlatformAdapter implements PlatformAdapter {
  readonly name = '@fluojs/platform-fastify';

  async listen(app: FluoRuntimeApplication): Promise<void> {
    await app.start();
  }

  async close(app: FluoRuntimeApplication): Promise<void> {
    await app.close();
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

- `createJwtGuard(secret)`를 `createJwtGuard(options)`로 변경함
```

### ✅ Correct

```ts
/**
 * 명시적 옵션으로 JWT 가드를 생성한다.
 */
export function createJwtGuard(options: JwtGuardOptions) {
  return new JwtGuard(options);
}
```

```md
Release governance note

- `1.0+`에서 공개 생성자 계약이 바뀌었으므로 메이저 릴리스가 필요함
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
