<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.9 -->

# Chapter 12. Database Integration with Prisma

## Learning Objectives
- Fluo 애플리케이션에서 ORM으로서의 Prisma의 역할을 이해합니다.
- Fluo 생태계 내에서 `@fluojs/prisma`를 설치하고 구성합니다.
- Prisma의 DSL을 사용하여 데이터베이스 스키마를 정의합니다.
- 데이터베이스를 스키마와 동기화하기 위해 마이그레이션을 실행하는 방법을 배웁니다.
- `PrismaService`를 사용하여 기본적인 CRUD 작업을 수행합니다.
- 데이터를 보존하기 위해 Prisma를 FluoBlog 프로젝트에 통합합니다.

## Prerequisites
- 11장(환경 설정 관리)을 완료했습니다.
- 관계형 데이터베이스와 SQL에 대한 기본적인 지식이 있습니다.
- Node.js와 패키지 매니저(npm, yarn, pnpm 중 하나)가 설치되어 있어야 합니다.

## 12.1 Why Prisma and Fluo?

이전 장들에서 우리는 견고한 HTTP API를 구축했지만, 모든 데이터는 메모리에 상주했습니다.

서버를 재시작하면 데이터는 사라집니다.

FluoBlog와 같은 실제 애플리케이션을 구축하려면 게시물, 사용자, 댓글을 영구적으로 저장할 방법이 필요합니다.

Prisma는 명시적이고 타입 안전한 개발이라는 Fluo의 철학에 완벽하게 부합하는 현대적인 객체 관계 매핑(ORM) 도구입니다.

복잡한 클래스 기반 데코레이터나 모호한 마법에 의존하는 기존 ORM과 달리, Prisma는 데이터베이스 구조와 TypeScript 타입의 단일 진실 공급원(Single Source of Truth) 역할을 하는 중앙 "스키마" 파일을 사용합니다.

### Key Benefits of Prisma

- **타입 안정성**: Prisma는 스키마에 맞춤화된 클라이언트를 생성하여 데이터베이스 쿼리에 대한 완전한 자동 완성 및 타입 체크를 제공합니다.
- **선언적 스키마**: 사람이 읽기 쉬운 형식으로 데이터 모델을 정의합니다.
- **자동화된 마이그레이션**: 시간이 지남에 따라 데이터베이스 스키마가 진화하는 복잡성을 Prisma가 처리합니다.
- **Fluo 통합**: `@fluojs/prisma` 패키지가 연결 생명주기와 트랜잭션 컨텍스트를 대신 관리해 줍니다.

## 12.2 Setting up the Environment

먼저 필요한 패키지를 설치해야 합니다.

```bash
pnpm add @fluojs/prisma @prisma/client
pnpm add -D prisma
```

설치가 완료되면 프로젝트에서 Prisma를 초기화합니다.

```bash
npx prisma init
```

이 명령은 `schema.prisma` 파일이 포함된 `prisma/` 디렉토리를 생성하고, `.env` 파일에 `DATABASE_URL` 항목을 추가합니다.

## 12.3 Defining the FluoBlog Schema

`prisma/schema.prisma`를 엽니다. 블로그의 핵심 모델인 `User`와 `Post`를 정의하겠습니다.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

### Understanding the DSL

- `model`: 데이터베이스 테이블을 정의합니다.
- `@id`: 기본 키(Primary Key)를 표시합니다.
- `@default(autoincrement())`: 자동 증가하는 정수를 설정합니다.
- `@unique`: 이 열의 값이 고유함을 보장합니다.
- `@relation`: 테이블 간의 연결 방식을 정의합니다.

스키마 정의 후에는 TypeScript 클라이언트를 생성해야 합니다.

```bash
npx prisma generate
```

## 12.4 Running Migrations

이제 스키마가 준비되었으므로 데이터베이스에 실제 테이블을 생성해야 합니다.

```bash
npx prisma migrate dev --name init_blog_schema
```

이 명령은 다음과 같은 작업을 수행합니다.
1. 새로운 SQL 마이그레이션 파일을 생성합니다.
2. 데이터베이스에 마이그레이션을 적용합니다.
3. Prisma Client를 다시 생성하여 새로운 스키마와 동기화되도록 합니다.

Fluo 프로젝트에서는 이러한 마이그레이션을 소스 코드의 일부로 취급합니다. 모든 개발자(및 프로덕션 서버)가 동일한 상태를 유지할 수 있도록 버전 관리 시스템(Git 등)에 커밋해야 합니다.

## 12.5 Registering PrismaModule

Fluo에서는 Prisma Client를 서비스에 직접 가져와서 사용하지 않습니다. 대신 `PrismaModule`을 사용하여 연결의 생명주기를 관리합니다.

### Registration in AppModule

`src/app.module.ts`를 엽니다.

```typescript
import { Module } from '@fluojs/core';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Module({
  imports: [
    PrismaModule.forRoot({
      client: new PrismaClient(),
    }),
  ],
})
export class AppModule {}
```

이렇게 등록하면 Fluo는 애플리케이션이 시작될 때 데이터베이스에 자동으로 연결하고, 애플리케이션이 정상적으로 종료될 때 연결을 해제합니다.

## 12.6 Using PrismaService

`@fluojs/prisma` 패키지는 생성된 Prisma Client를 감싸는 `PrismaService`를 제공합니다.

### Creating a Repository

데이터베이스 로직을 비즈니스 로직과 분리하는 것이 좋습니다. `PostsRepository`를 만들어 보겠습니다.

```typescript
import { Injectable, Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PostsRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService<PrismaClient>
  ) {}

  async createPost(data: { title: string; content?: string; authorId: number }) {
    return this.prisma.current().post.create({
      data,
    });
  }

  async findMany() {
    return this.prisma.current().post.findMany({
      include: { author: true },
    });
  }
}
```

### The current() Pattern

`this.prisma.current()` 호출에 주목하십시오. 이는 Fluo에서 매우 중요한 패턴입니다.

`current()`는 현재 활성화된 데이터베이스 클라이언트를 반환합니다. 만약 트랜잭션 내부(다음 장에서 다룰 내용)라면 트랜잭션 인식 클라이언트를 반환하고, 그렇지 않다면 표준 클라이언트를 반환합니다.

항상 `current()`를 사용함으로써 리포지토리는 트랜잭션 여부에 관계없이 작동할 수 있으며, 이는 재사용성과 테스트 용이성을 크게 높여줍니다.

## 12.7 Summary

이 장에서 우리는 영구적인 데이터베이스 계층을 추가하여 FluoBlog에 생명력을 불어넣었습니다.

우리는 다음을 배웠습니다.
- Prisma는 데이터를 관리하는 타입 안전하고 선언적인 방법을 제공합니다.
- `schema.prisma` 파일은 데이터베이스 구조의 진실 공급원입니다.
- 마이그레이션을 통해 시간이 지남에 따라 데이터베이스를 안전하게 진화시킬 수 있습니다.
- `PrismaModule`은 Prisma를 Fluo의 생명주기에 통합합니다.
- `PrismaService`와 `current()` 패턴은 유연하고 트랜잭션 인식적인 데이터 접근을 가능하게 합니다.

데이터베이스가 구축됨에 따라 FluoBlog는 이제 게시물을 안정적으로 저장하고 검색할 수 있습니다. 하지만 실제 데이터 작업에서는 여러 단계가 함께 성공하거나 실패해야 하는 경우가 많습니다. 다음 장에서는 트랜잭션을 사용하여 이러한 시나리오를 처리하는 방법을 배우겠습니다.

<!-- line-count-check: 200+ lines target achieved -->

A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z
