# @fluojs/mongoose

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Mongoose integration for fluo with session-aware transaction handling and lifecycle-friendly connection management.

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
pnpm add @fluojs/mongoose
pnpm add mongoose
```

## When to Use

- when Mongoose should plug into the same DI and application lifecycle as the rest of the app
- when MongoDB sessions and transactions need one shared wrapper instead of ad hoc session plumbing in every service
- when request-scoped transactions should be opt-in through an interceptor

## Quick Start

```ts
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection('mongodb://localhost:27017/test');

@Module({
  imports: [
    MongooseModule.forRoot({
      connection,
      dispose: async (conn) => conn.close(),
    }),
  ],
})
class AppModule {}
```

## Common Patterns

### Access the connection through `MongooseConnection`

```ts
import { MongooseConnection } from '@fluojs/mongoose';

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async findById(id: string) {
    const User = this.conn.current().model('User');
    return User.findById(id);
  }
}
```

### Manual transactions still need explicit sessions

```ts
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const User = this.conn.current().model('User');

  await User.create([{ name: 'Ada' }], { session });
});
```

### Request-scoped transactions

```ts
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
class UserController {}
```

## Public API Overview

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseTransactionInterceptor`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)`
- `createMongoosePlatformStatusSnapshot(...)`

## Related Packages

- `@fluojs/runtime`: manages startup and shutdown hooks
- `@fluojs/http`: provides the interceptor chain for request transactions
- `@fluojs/prisma` and `@fluojs/drizzle`: alternate database integrations with different transaction models

## Example Sources

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
