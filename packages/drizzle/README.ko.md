# @konekti/drizzle

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

트랜잭션 인지형 데이터베이스 래퍼와 선택적 dispose hook을 제공하는 Konekti용 Drizzle ORM 통합 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/drizzle
```

## 사용 시점

- Drizzle을 다른 Konekti 모듈과 같은 DI·모듈·라이프사이클 모델 안에 넣고 싶을 때
- repository 코드가 root handle과 현재 트랜잭션 handle 사이를 `current()` 하나로 다루고 싶을 때
- 애플리케이션 종료 시 underlying driver 정리 로직도 함께 실행해야 할 때

## 빠른 시작

```ts
import { ConfigService } from '@konekti/config';
import { Module } from '@konekti/core';
import { DrizzleModule } from '@konekti/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
          dispose: async () => {
            await pool.end();
          },
        };
      },
    }),
  ],
})
export class AppModule {}
```

## 주요 패턴

### repository에서 `DrizzleDatabase.current()` 사용하기

```ts
import { DrizzleDatabase } from '@konekti/drizzle';
import { eq } from 'drizzle-orm';
import { users } from './schema';

export class UserRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findById(id: string) {
    return this.db.current().select().from(users).where(eq(users.id, id));
  }
}
```

### 수동 트랜잭션 경계

```ts
await this.db.transaction(async () => {
  const tx = this.db.current();
  await tx.insert(users).values(user);
  await tx.insert(profiles).values(profile);
});
```

### 인터셉터 기반 요청 단위 트랜잭션

```ts
import { UseInterceptors } from '@konekti/http';
import { DrizzleTransactionInterceptor } from '@konekti/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
class UsersController {}
```

## 공개 API 개요

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `createDrizzleProviders(options)`
- `DrizzleDatabase`
- `DrizzleTransactionInterceptor`
- `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_OPTIONS`
- `createDrizzlePlatformStatusSnapshot(...)`

## 관련 패키지

- `@konekti/runtime`: 모듈 시작과 종료 순서를 관리합니다.
- `@konekti/http`: 요청 단위 트랜잭션에 쓰이는 인터셉터 파이프라인을 제공합니다.
- `@konekti/prisma`, `@konekti/mongoose`: 같은 런타임 모델 위에서 동작하는 다른 데이터 통합 패키지입니다.

## 예제 소스

- `packages/drizzle/src/vertical-slice.test.ts`
- `packages/drizzle/src/module.test.ts`
- `packages/drizzle/src/public-api.test.ts`
