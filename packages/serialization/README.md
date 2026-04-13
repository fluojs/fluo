# @fluojs/serialization

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Class-based response serialization and output shaping for fluo with decorator-aware recursive object walking.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/serialization
```

## When to Use

- when you need output DTOs to expose only a controlled subset of fields
- when sensitive values such as password hashes or internal identifiers must never leave the response boundary
- when response data needs lightweight synchronous transforms during serialization
- when you want an HTTP interceptor to apply the same serialization rules automatically

## Quick Start

```ts
import { Exclude, Expose, Transform, serialize } from '@fluojs/serialization';

class UserEntity {
  @Expose()
  id = '';

  @Expose()
  @Transform((value) => value.toUpperCase())
  username = '';

  @Exclude()
  passwordHash = '';
}

const user = Object.assign(new UserEntity(), {
  id: '1',
  username: 'fluo',
  passwordHash: 'secret',
});

console.log(serialize(user));
// { id: '1', username: 'FLUO' }
```

## Common Patterns

### Expose-only output DTOs

```ts
import { Expose } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
class SecureDto {
  @Expose()
  publicData = 'visible';

  internalData = 'hidden';
}
```

### Value transforms

```ts
import { Transform } from '@fluojs/serialization';

class ProductDto {
  @Transform((price) => `$${price.toFixed(2)}`)
  price = 0;
}
```

### HTTP response shaping with an interceptor

```ts
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/users')
@UseInterceptors(SerializerInterceptor)
class UsersController {
  @Get('/')
  findAll() {
    return [new UserEntity()];
  }
}
```

### Cycle-safe serialization

The serializer cuts cyclic references safely instead of recursing forever, so complex object graphs can still be turned into plain response-shaped objects without unbounded recursion.

### Non-JSON leaf values

`serialize()` applies decorator metadata and recursively walks arrays/plain objects, but it does not coerce every leaf into strict JSON types. Values such as `Date`, `bigint`, functions, and symbols can pass through unchanged unless you normalize them with `@Transform(...)` or before writing the final HTTP response.

## Public API Overview

- **Decorators**: `Expose`, `Exclude`, `Transform`
- **Engine**: `serialize(value)`
- **HTTP integration**: `SerializerInterceptor`

## Related Packages

- `@fluojs/http`: applies `SerializerInterceptor` to HTTP handlers
- `@fluojs/validation`: handles input-side DTO materialization and validation

## Example Sources

- `packages/serialization/src/serialize.test.ts`
- `packages/serialization/src/serializer-interceptor.test.ts`
