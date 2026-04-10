# @konekti/prisma

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 애플리케이션을 위한 Prisma 라이프사이클 및 ALS 기반 트랜잭션 컨텍스트 모듈입니다. Prisma 클라이언트를 모듈 시스템에 연결하여 자동 연결 관리 및 요청 범위 트랜잭션을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [PrismaService와 current()](#prismaservice와-current)
  - [수동 트랜잭션](#수동-트랜잭션)
  - [자동 요청 트랜잭션](#자동-요청-트랜잭션)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @konekti/prisma
# @prisma/client도 함께 설치되어 있어야 합니다.
pnpm add @prisma/client
```

## 사용 시점

- Prisma를 ORM으로 사용하면서 Konekti의 의존성 주입 및 라이프사이클 훅과 통합하고 싶을 때.
- 여러 서비스와 리포지토리 사이에서 `tx` 객체를 일일이 전달하지 않고도 트랜잭션 컨텍스트를 안정적으로 공유하고 싶을 때.
- 애플리케이션 시작 시 자동 `$connect`, 종료 시 자동 `$disconnect`가 필요할 때.

## 빠른 시작

루트 모듈에 `PrismaClient` 인스턴스를 전달하여 `PrismaModule`을 등록합니다.

```typescript
import { Module } from '@konekti/core';
import { PrismaModule } from '@konekti/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Module({
  imports: [
    PrismaModule.forRoot({ client: prisma }),
  ],
})
class AppModule {}
```

## 공통 패턴

### PrismaService와 current()

`PrismaService`는 Prisma와 상호작용하는 기본 방법입니다. `current()` 메서드는 트랜잭션 범위 내에 있으면 자동으로 트랜잭션용 클라이언트를, 그렇지 않으면 루트 클라이언트를 반환합니다.

```typescript
import { PrismaService } from '@konekti/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class UserRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async findById(id: string) {
    // current()는 생성된 Prisma 타입과 자동완성을 그대로 유지합니다.
    return this.prisma.current().user.findUnique({ where: { id } });
  }
}
```

### 수동 트랜잭션

`prisma.transaction()`을 사용하여 대화형 트랜잭션 블록을 생성합니다. 블록 내부의 모든 `current()` 호출은 트랜잭션 범위의 클라이언트를 사용합니다.

```typescript
await this.prisma.transaction(async () => {
  const user = await this.prisma.current().user.create({ data });
  await this.prisma.current().profile.create({ data: { userId: user.id } });
});
```

### 자동 요청 트랜잭션

컨트롤러나 메서드에 `PrismaTransactionInterceptor`를 적용하면 전체 요청을 자동으로 트랜잭션으로 감쌉니다.

```typescript
import { UseInterceptors } from '@konekti/http';
import { PrismaTransactionInterceptor } from '@konekti/prisma';

@UseInterceptors(PrismaTransactionInterceptor)
class UserController {
  @Post()
  async create() {
    // 이후 PrismaService.current()를 사용하는 모든 리포지토리 호출은 이 트랜잭션을 공유합니다.
  }
}
```

## 공개 API 개요

### `PrismaModule`

- `static forRoot(options: PrismaModuleOptions): ModuleType`
- `static forRootAsync(options: PrismaModuleAsyncOptions): ModuleType`
  - `strictTransactions: true` 설정 시 트랜잭션 미지원 환경에서 즉시 예외를 발생시킵니다.

### `PrismaService<TClient>`

- `current(): TClient`
  - 현재 컨텍스트에 맞는 트랜잭션 클라이언트 또는 루트 클라이언트를 반환합니다.
- `transaction(fn, options?): Promise<T>`
  - 대화형 트랜잭션 내에서 함수를 실행합니다.
- `requestTransaction(fn, signal?, options?): Promise<T>`
  - HTTP 요청 라이프사이클에 특화된 트랜잭션 경계를 실행합니다.

### `PRISMA_CLIENT` (Token)

원시 `PrismaClient` 인스턴스를 위한 주입 토큰입니다.

## 관련 패키지

- `@konekti/runtime`: 애플리케이션 라이프사이클 훅을 관리합니다.
- `@konekti/http`: 인터셉터 시스템을 제공합니다.
- `@konekti/terminus`: Prisma를 위한 헬스 인디케이터를 제공합니다.

## 예제 소스

- `packages/prisma/src/vertical-slice.test.ts`: 표준 DTO → 서비스 → 리포지토리 → Prisma 흐름 예제.
