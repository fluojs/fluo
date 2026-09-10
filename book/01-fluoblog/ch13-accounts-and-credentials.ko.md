# 사용자와 자격 증명 모델링하기

<!-- book:volume=01-fluoblog;chapter=13 -->

[이전: 글이 많아져도 목록이 느려지지 않게 하기](./ch12-efficient-queries.ko.md) · [1권 목차](./toc.ko.md) · [다음: 로그인 상태를 검증하기](./ch14-authentication.ko.md)

## 글의 작성자가 더는 한 사람이 아닐 때

FluoBlog에 동료 개발자가 글을 기고하고 싶다는 메시지를 보냈다. 운영자는 처음에 관리자 비밀번호를 알려 주려다가 멈춘다. 그 비밀번호로 들어온 사람이 누구인지 구별할 수 없고, 한 사람이 떠나면 모두의 비밀번호를 바꿔야 한다. 글에는 작성자 이름을 문자열로 넣을 수 있지만, 이름을 바꾼 뒤에도 같은 사람인지 알아야 한다. 게시글을 오래 보관하려면 화면에 표시할 이름과 소유권을 판단할 식별자를 분리해야 한다.

앞 장까지의 제품에는 PostgreSQL에 저장한 게시글과 발행 규칙, 목록 조회 경로가 있다. 이 장은 그 데이터베이스에 계정을 추가한다. 별도의 인증 서버를 먼저 만드는 대신 `src/accounts/`에 작은 기능 경계를 세운다. 이 경계는 사람의 식별자, 로그인에 쓸 이메일 키, 비밀번호 검증 자료를 소유한다. `PostsModule`은 비밀번호를 알 필요가 없다. 나중에 같은 블로그가 상품을 판매하더라도 주문의 `customerId`는 여기서 만든 사용자 ID를 참조한다. 고객이 된다는 이유로 두 번째 계정 테이블을 만들지 않는다.

이 장의 애플리케이션 코드는 독자가 생성한 `fluo-blog`에 적용하는 구현이다. 저장소의 `examples/fluo-blog`가 이 데이터베이스나 계정 기능까지 갖춘 완성 앱이라는 뜻은 아니다. 실행 기준은 Node.js 24와 pnpm 10이며, 10장에서 선택한 PostgreSQL 연결과 생성된 Prisma Client를 이어 쓴다. 다음 스키마는 기존 파일 전체를 대체하는 파일이 아니라 **`prisma/schema.prisma`에 합치는 애플리케이션 스키마 조각**이다. 기존 generator와 datasource는 유지한다.

## 사람과 비밀번호는 수명이 다르다

사용자 ID에 이메일을 쓰면 구현이 짧아 보인다. 그러나 이메일 변경이 게시글 외래 키 변경이 되고, 이메일 재사용이 다른 사람의 과거 글과 연결될 위험도 생긴다. ID는 의미 없는 안정적인 문자열로 정하고, 이메일은 변경 가능한 로그인 식별자로 둔다. 비밀번호는 재설정하거나 폐기할 수 있지만 계정과 게시글은 남아야 한다. 그래서 검증 자료를 별도 테이블에 둔다.

```prisma
enum AccountStatus {
  active
  disabled
}

model User {
  id             String              @id @default(uuid())
  emailKey       String              @unique
  displayName    String
  status         AccountStatus       @default(active)
  authVersion    Int                 @default(1)
  createdAt      DateTime            @default(now())
  credential     PasswordCredential?
  posts          Post[]
}

model PasswordCredential {
  userId         String              @id
  passwordHash   String
  changedAt      DateTime            @default(now())
  user           User                @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

`Post`에는 `authorId String`과 `author User @relation(fields: [authorId], references: [id], onDelete: Restrict)`를 추가한다. 게시글의 `id`, `title`, `content`, `slug`, `status`, `version`, `publishedAt`는 그대로 유지한다. `authorId`의 문자열 타입은 `User.id`와 같아야 한다. 이미 `authorId`가 있다면 새 필드를 중복해서 만들지 말고 실제 ID와 외래 키를 연결한다. 뒤 장의 수정 예제는 게시글 ID를 양의 정수로, 사용자 ID를 기존 ID를 포함한 문자열로 사용한다. 두 식별자의 모양을 같게 만들 필요는 없다.

`credential`이 선택적인 것은 가입 도중 비밀번호가 없어도 된다는 허가가 아니다. 지금 구현하는 비밀번호 가입 경로는 두 행을 함께 만든다. 선택적인 관계는 계정 수명 전체에서 비밀번호가 폐기된 상태를 표현하고, 향후 외부 인증 수단을 도입할 때도 같은 `User.id`를 유지하게 한다. 현재 로그인 구현은 자격 증명이 없는 계정을 인증하지 않는다.

기존 `authorId`는 이미 필수 문자열이므로 nullable 열을 다시 만들거나 UUID로 일괄 교체하지 않는다. `author-1`도 유효한 기존 사용자 ID이며 새 가입만 UUID 기본값을 받는다. 다음 개발 마이그레이션을 생성한다.

```bash
pnpm exec prisma migrate dev --name add_accounts --create-only
```

생성된 SQL에서 `User`와 `PasswordCredential` 생성은 유지한다. 자동 생성된 `Post_authorId_fkey` 추가문을 아래 블록으로 교체하여 기존 운영자 행을 먼저 만든 뒤 외래 키를 건다. 쓰기를 중지한 연습 DB에서 수행한다. 다른 작성자 ID가 있으면 실제 소유권에 맞는 계정 행을 먼저 준비해야 하며 누락을 임의의 운영자 귀속으로 숨기지 않는다.

```sql
INSERT INTO "User" ("id", "emailKey", "displayName", "status", "authVersion", "createdAt")
VALUES ('author-1', 'uninitialized-operator@example.invalid', 'Legacy operator', 'disabled', 1, CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Post" p LEFT JOIN "User" u ON u."id" = p."authorId"
    WHERE u."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Map every existing author before adding Post_authorId_fkey';
  END IF;
END;
$$;

ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

기존 seed의 `Post.id=1`, `authorId=author-1`, `version=2`, 발행 시각과 `PostPublication.actorId`는 바뀌지 않는다. 비밀번호 없는 임시 운영자 계정은 `disabled`여서 로그인할 수 없다. 아래 초기화는 이 실제 계정에만 자격 증명을 한 번 연결한다. 공개 가입 경로에서 `id=author-1`을 받거나 임의의 가입자를 과거 글의 소유자로 삼지 않는다.

`onDelete: Restrict`는 계정 삭제가 글 삭제로 전파되는 것을 막는다. 비밀번호 자료는 계정과 함께 없어져도 되지만, 발행된 글의 보존은 별도 제품 정책이다. 여기서는 탈퇴나 운영 제한을 물리 삭제 대신 `disabled` 상태로 표현한다. 영구 삭제와 익명화의 보존 기간은 다른 문제이며, 비활성 상태를 개인정보 삭제 완료라고 표시해서는 안 된다.

## 입력 정규화는 제품의 명시적인 규칙이다

가입 요청 두 개가 `Writer@Example.com`과 `writer@example.com`을 보냈을 때 다른 계정으로 만들 것인가? FluoBlog는 이 둘을 같은 로그인 키로 취급한다. 모든 메일 시스템이 똑같이 해석한다는 주장이 아니라 이 제품의 가입 규칙이다. 이 예제는 ASCII 이메일 주소만 받으며, 앞뒤 공백을 제거하고 전체를 소문자로 바꾼다. 점이나 `+tag`를 지우는 특정 메일 제공자 규칙은 적용하지 않는다. 이메일 검증 메일도 보내지 않으므로 `emailKey`가 존재한다는 사실은 그 주소를 소유했다는 증거가 아니다.

다음은 **완전한 파일 `src/accounts/account-input.ts`**이다. 비밀번호는 이메일처럼 정규화하지 않는다. 앞뒤 공백을 지우거나 유니코드 정규화를 적용하면 사용자가 입력한 비밀과 저장한 비밀이 달라진다. 길이의 하한은 짧은 비밀번호를 막는 제품 정책이고 상한은 해시 작업에 들어가기 전 자원 사용을 제한하는 경계다.

```ts
export class AccountInputError extends Error {}
export class AccountConflictError extends Error {}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AccountInputError('Invalid email.');
  }
  const key = value.trim().toLowerCase();
  if (
    key.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(key)
  ) {
    throw new AccountInputError('Unsupported email format.');
  }
  return key;
}

export function validatePassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    [...value].length < 12 ||
    [...value].length > 128
  ) {
    throw new AccountInputError('Password must contain 12 to 128 characters.');
  }
  return value;
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AccountInputError('Invalid display name.');
  }
  const name = value.trim();
  if ([...name].length < 1 || [...name].length > 60) {
    throw new AccountInputError('Display name must contain 1 to 60 characters.');
  }
  return name;
}
```

표시 이름은 사용자에게 보여 주기 위한 값일 뿐, URL의 작성자 ID나 권한 비교 키가 아니다. 저장 전에 이름을 HTML 문자열로 바꾸지도 않는다. HTML 출력의 이스케이프는 출력 문맥에서 해야 한다. 이처럼 각 값이 어디에 쓰이는지 정하면 입력 검증이 만능 문자열 정리 함수로 커지는 것을 피할 수 있다.

## 해시를 저장한다는 말의 실제 구현

비밀번호를 복호화할 수 있는 암호문으로 보관하면 로그인 서버가 원문을 다시 얻을 수 있다. 여기서는 원문을 복원하지 않고 후보 비밀번호로 같은 계산을 수행해 비교한다. 빠른 SHA-256 한 번은 대량 추측에도 빠르다. Node의 비동기 `scrypt`로 메모리와 CPU 비용을 부과하고 사용자마다 무작위 salt를 만든다. Fluo의 Prisma 등록은 이 처리를 대신하지 않는다.

다음은 **완전한 파일 `src/accounts/password-hasher.ts`**이다. 저장 형식의 버전 `scrypt-v1`이 비용 설정을 가리킨다. 외부 문자열에서 임의의 비용을 읽어 실행하지 않으므로 손상된 저장값이 무제한 메모리 할당을 요구하지 못한다. 비용을 바꿀 때에는 같은 버전 이름의 의미를 바꾸지 말고 새로운 버전과 이전 버전 검증 경로를 설계한다.

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export class PasswordHasher {
  readonly dummyHash = [
    'scrypt-v1',
    Buffer.alloc(SALT_BYTES).toString('base64url'),
    Buffer.alloc(KEY_BYTES).toString('base64url'),
  ].join('$');

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt);
    return `scrypt-v1$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async matches(password: string, encoded: string): Promise<boolean> {
    const match = /^scrypt-v1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded);
    if (!match) throw new Error('Invalid stored password hash format.');
    const saltText = match[1];
    const keyText = match[2];
    if (saltText === undefined || keyText === undefined) {
      throw new Error('Missing stored password hash fields.');
    }
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (
      salt.toString('base64url') !== saltText ||
      expected.toString('base64url') !== keyText
    ) {
      throw new Error('Invalid stored password hash encoding.');
    }
    const actual = await derive(password, salt);
    return timingSafeEqual(expected, actual);
  }
}
```

`dummyHash`는 실제 사용자 비밀번호가 아니다. 존재하지 않는 계정을 조회했을 때도 같은 비용의 해시 계산을 수행하기 위한 비교 자료다. 이 계산만으로 로그인 응답 시간이 완전히 같아지는 것은 아니다. 데이터베이스 캐시, 스케줄링, 네트워크도 시간을 바꾼다. 중요한 것은 계정이 없다는 이유로 가장 비싼 단계를 통째로 건너뛰지 않는 것이다. 저장된 해시가 깨졌을 때는 일반 로그인 실패로 조용히 감추지 않고 내부 오류로 드러낸다. 운영자는 자격 증명 손상과 틀린 비밀번호를 구별해야 한다.

`scrypt`의 비동기 API는 이벤트 루프를 직접 막지 않지만 무제한 요청을 감당한다는 뜻은 아니다. 계산은 호스트 자원을 사용하고 동시에 많이 실행되면 로그인 지연이 커진다. 위 비용은 학습 구현의 명시적인 시작점이지 모든 서버의 적정값이 아니다. 실제 CPU와 동시 로그인 수에서 측정해 정하며, 16장에서 해시 작업에 도달하는 요청 수를 제한한다. 로그인 지연을 줄인다는 이유로 비용을 극단적으로 낮추면 데이터 유출 뒤의 추측 비용도 함께 낮아진다.

## 두 행을 한 번에 만들고 필요한 값만 내보내기

가입 전 `findUnique`로 이메일 중복을 확인해도 두 요청이 동시에 빈 결과를 볼 수 있다. 중복 방지의 최종 책임은 `emailKey`의 unique 제약에 둔다. 가입 성공의 단위는 `User`와 `PasswordCredential`을 함께 만드는 작업이다. Prisma의 중첩 쓰기를 사용하면 사용자만 생기고 비밀번호 저장은 실패하는 중간 상태를 커밋하지 않는다. 비밀번호 해시는 데이터베이스 트랜잭션을 열기 전에 계산한다.

다음은 **완전한 파일 `src/accounts/accounts.service.ts`**이다. 생성된 Prisma Client가 위 모델을 포함해야 한다. 공개 가입 응답은 `AccountView`, 인증 모듈로 전달할 내부 자료는 `AuthenticatedAccount`로 구분한다. Prisma 행 전체를 반환한 다음 컨트롤러에서 민감한 필드를 지우는 방식보다 처음부터 `select`로 반환 범위를 정하는 편이 안전하다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AccountConflictError,
  normalizeDisplayName,
  normalizeEmail,
  validatePassword,
} from './account-input.js';
import { PasswordHasher } from './password-hasher.js';

export type AccountView = { id: string; displayName: string };
export type AuthenticatedAccount = AccountView & { authVersion: number };

@Inject(PrismaService, PasswordHasher)
export class AccountsService {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly passwords: PasswordHasher,
  ) {}

  async register(input: {
    email: unknown;
    password: unknown;
    displayName: unknown;
  }): Promise<AccountView> {
    const emailKey = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = normalizeDisplayName(input.displayName);
    const passwordHash = await this.passwords.hash(password);
    try {
      return await this.prisma.user.create({
        data: {
          emailKey,
          displayName,
          credential: { create: { passwordHash } },
        },
        select: { id: true, displayName: true },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AccountConflictError('Registration is unavailable for this email.');
      }
      throw error;
    }
  }

  async verifyPassword(
    email: unknown,
    passwordInput: unknown,
  ): Promise<AuthenticatedAccount | null> {
    const emailKey = normalizeEmail(email);
    const password = validatePassword(passwordInput);
    const user = await this.prisma.user.findUnique({
      where: { emailKey },
      select: {
        id: true,
        displayName: true,
        status: true,
        authVersion: true,
        credential: { select: { passwordHash: true } },
      },
    });
    const matches = await this.passwords.matches(
      password,
      user?.credential?.passwordHash ?? this.passwords.dummyHash,
    );
    if (!user || !user.credential || !matches || user.status !== 'active') {
      return null;
    }
    return {
      id: user.id,
      displayName: user.displayName,
      authVersion: user.authVersion,
    };
  }

  async findActiveSubject(id: string): Promise<AuthenticatedAccount | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        status: true,
        authVersion: true,
      },
    });
    if (!user || user.status !== 'active') return null;
    return {
      id: user.id,
      displayName: user.displayName,
      authVersion: user.authVersion,
    };
  }
}
```

중복 오류 분기는 이 가입 쓰기에서 위반할 수 있는 사용자 입력 unique 키가 `emailKey`라는 스키마를 전제로 한다. 앞으로 닉네임 같은 unique 입력을 추가하면 오류 분류도 함께 바꾼다. 모든 데이터베이스 오류를 가입 중복으로 바꾸면 연결 장애까지 사용자 탓으로 표시하게 된다. 해시 원문이나 SQL 매개변수를 오류 메시지에 합치지 않는 것도 같은 경계의 일부다.

모듈 등록을 생략하면 타입이 올바른 클래스도 실행되지 않는다. 아래는 **완전한 파일 `src/accounts/accounts.module.ts`**이다. `PasswordHasher`를 구현한 클래스 자체를 실제 DI 토큰으로 사용한다. 인터페이스 이름을 생성자에 적는 것만으로는 주입되지 않는다.

```ts
import { Module } from '@fluojs/core';
import { AccountsService } from './accounts.service.js';
import { PasswordHasher } from './password-hasher.js';

@Module({
  providers: [PasswordHasher, AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
```

데이터베이스는 앱 전체에서 하나의 등록을 공유한다. 다음은 **`src/app.ts`의 전체 등록 파일**이다. 10장의 `src/database/blog-database.module.ts`에서 `AppSettings`를 주입받아 컨테이너별 클라이언트를 만드는 `BlogDatabaseModule`을 그대로 가져온다. `AccountsModule`만 추가하며 기존 OpenAPI도 유지한다.

```ts
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { AppSettingsModule } from './config/app-settings.module.js';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { PostsController } from './posts/posts.controller.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [
    AppSettingsModule, BlogDatabaseModule, AccountsModule, PostsModule,
    OpenApiModule.forRoot({
      title: 'FluoBlog API', version: '1.0.0',
      sources: [{ controllerToken: PostsController }],
      documentPath: '/openapi.json', uiPath: '/docs', ui: true,
      defaultErrorResponsesPolicy: 'inject',
    }),
  ],
})
export class AppModule {}
```

여기서 `global`은 계정과 게시글이 동일한 데이터베이스 제공자를 보게 하려는 의도적인 선택이다. 여러 데이터베이스가 필요한 제품이라면 이름 있는 등록과 명시적인 import 경계를 선택할 수 있지만 지금은 필요하지 않다. `strictTransactions`는 트랜잭션 기능이 없는 가짜 클라이언트에서 원자성이 있는 척 실행되는 것을 막는다. `PrismaModule`은 연결과 종료를 관리하지만 스키마나 마이그레이션을 생성·적용해 주지 않는다.

## 기존 운영자 계정에 자격 증명 연결하기

마이그레이션 뒤 실제 운영자만 로컬에서 실행할 **`src/accounts/initialize-operator.ts` 전체**다. 비밀 입력 `OPERATOR_EMAIL`, `OPERATOR_DISPLAY_NAME`, `OPERATOR_PASSWORD`는 프로세스 환경으로 주며 출력하거나 소스에 넣지 않는다. 조건부 갱신과 자격 증명 생성은 함께 커밋되고 재실행은 실패한다.

```ts
import { Inject, Module } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { FluoFactory } from '@fluojs/runtime';
import type { PrismaClient } from '@prisma/client';
import { AppSettingsModule } from '../config/app-settings.module.js';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { normalizeEmail, normalizeDisplayName, validatePassword } from './account-input.js';
import { PasswordHasher } from './password-hasher.js';

@Inject(PrismaService, PasswordHasher)
export class OperatorInitializer {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly passwords: PasswordHasher,
  ) { }

  async initialize(input: { email: unknown; displayName: unknown; password: unknown }) {
    const emailKey = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const passwordHash = await this.passwords.hash(validatePassword(input.password));
    await this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const changed = await db.user.updateMany({
        where: {
          id: 'author-1', status: 'disabled',
          emailKey: 'uninitialized-operator@example.invalid',
          credential: { is: null },
        },
        data: { emailKey, displayName, status: 'active' },
      });
      if (changed.count !== 1) throw new Error('The legacy operator is missing or already initialized.');
      await db.passwordCredential.create({ data: { userId: 'author-1', passwordHash } });
    });
  }
}

@Module({
  imports: [AppSettingsModule, BlogDatabaseModule],
  providers: [PasswordHasher, OperatorInitializer],
})
class OperatorInitializationModule { }

export async function initializeOperator() {
  const app = await FluoFactory.create(OperatorInitializationModule);
  try {
    const initializer = await app.container.resolve(OperatorInitializer);
    await initializer.initialize({
      email: process.env.OPERATOR_EMAIL,
      displayName: process.env.OPERATOR_DISPLAY_NAME,
      password: process.env.OPERATOR_PASSWORD,
    });
  } finally {
    await app.close();
  }
}
```

**`src/initialize-operator.ts` 전체**는 메타데이터를 먼저 준비한 뒤 위 함수를 실행한다. 앱과 동일한 표준 데코레이터 빌드 설정으로 이 진입점을 변환하고 생성된 JavaScript를 Node.js 24에서 한 번 실행한다. HTTP 서버나 두 번째 Prisma 등록을 시작하지 않는다.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
const { initializeOperator } = await import('./accounts/initialize-operator.js');
await initializeOperator();
```

초기화 후 14장의 로그인 결과 `user.id`와 `/auth/me`는 `author-1`이어야 한다. 새 기고자의 ID는 별개의 문자열이다. 게시글·발행 기록의 개수와 버전은 초기화 전후 동일해야 하고, 같은 초기화의 재실행은 비밀번호를 바꾸지 않아야 한다. 10~12장의 계정 도입 전 테스트를 이 스키마에서 실행하려면 이 마이그레이션의 운영자 행도 필요하며, 테스트 정리는 계정 seed를 지우지 않는다.

## 상태 변경도 인증 정책의 일부다

운영자가 계정을 정지했는데 이미 발행된 토큰으로 계속 글을 수정할 수 있다면 `status` 열만 추가한 것으로는 부족하다. 이 장에서 둔 `authVersion`은 계정 전체의 인증 세대를 나타낸다. 비밀번호 변경이나 전체 로그아웃 시 검증 자료 변경과 함께 이 숫자를 증가시키고, 다음 장의 토큰은 발행 당시 숫자를 담는다. 요청을 인증할 때 현재 값과 다르면 오래된 토큰으로 판단한다.

예를 들어 비밀번호 변경은 새 해시를 먼저 계산한 뒤 하나의 `prisma.transaction` 안에서 `current().passwordCredential.update`와 `current().user.update`를 실행해야 한다. 첫 쓰기 후 두 번째 쓰기가 실패하면 둘 다 롤백되어야 한다. 이전 비밀번호를 다시 확인하지 않는 공개 변경 API를 이 내부 작업에 연결해서는 안 된다. 이 장은 가입과 검증을 구현하며 비밀번호 재설정 이메일이나 공개 변경 경로를 만들지는 않는다. 재설정 토큰을 안전하게 보관하는 설계 없이 `/reset`이라는 URL만 추가하는 것은 기능 완성이 아니다.

숫자 하나는 특정 기기만 로그아웃시키지 못한다. 모든 기기를 함께 끊는 요구에는 간결하지만, 기기별 세션 목록이 필요하면 별도의 세션 ID와 영속 저장소가 필요하다. 이 차이를 알고 선택해야 한다. 계정이 활성이었다는 조회 결과도 영원하지 않다. 인증 확인 직후 정지가 커밋되면 이미 실행 중인 요청 하나는 진행할 수 있다. 다음 장은 새 인증 판단부터 정지를 반영하며, 아주 엄격한 쓰기 차단이 필요한 경우에는 쓰기 트랜잭션과 계정 상태의 직렬화 정책까지 확장해야 한다.

## 실패를 관찰하는 실험

먼저 해시 계산은 데이터베이스 없이 확인할 수 있다. 아래는 **완전한 테스트 파일 `src/accounts/password-hasher.test.ts`**이다. 프로젝트의 기존 Vitest 설정에서 Node.js 24로 실행한다. 시간 자체가 검증 대상이 아니므로 밀리초 단위 성능을 성공 조건으로 두지 않는다.

```ts
import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  it('uses independent salts and accepts only a matching password', async () => {
    const hasher = new PasswordHasher();
    const password = 'correct horse battery staple';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await hasher.matches(password, first)).toBe(true);
    expect(await hasher.matches('another password value', first)).toBe(false);
    await expect(hasher.matches(password, 'broken')).rejects.toThrow();
  });
});
```

```bash
pnpm exec vitest run src/accounts/password-hasher.test.ts
```

가입의 원자성과 중복은 실제 PostgreSQL에서 확인해야 한다. 다른 테스트와 공유하지 않는 개발 데이터베이스에 스키마를 적용하고 앱 컨테이너에서 `AccountsService`를 resolve한다. 서로 다른 표시 이름과 같은 정규화 이메일로 `register` 두 개를 `Promise.allSettled`로 동시에 호출한다. 기대 결과는 성공 하나와 `AccountConflictError` 하나, 해당 이메일의 `User` 한 행과 연결된 `PasswordCredential` 한 행이다. 요청 직렬 실행만으로는 중복 검사와 쓰기 사이의 경합을 재현하지 못한다.

다음으로 올바른 비밀번호, 틀린 비밀번호, 존재하지 않는 이메일, 비활성 계정, 자격 증명 행이 없는 계정을 비교한다. 성공한 경우만 `id`, `displayName`, `authVersion`을 얻고 나머지는 `null`이어야 한다. 입력 형식 자체가 잘못되면 `AccountInputError`다. HTTP 계층은 다음 장에서 이 차이를 매핑하되 실패 응답으로 계정 존재 여부를 알려 주지 않는다. 가입 성공 객체를 직렬화했을 때 `passwordHash`, `emailKey`, `credential`이 없는지도 확인한다.

실제 행 중첩 쓰기의 부분 실패를 확인하려면 테스트 전용 PostgreSQL 제약으로 자격 증명 삽입을 거부하는 경우를 만들고 사용자 행도 남지 않는지 조회한다. 이를 가짜 클라이언트의 `create` 호출 횟수 검사로 대체하면 데이터베이스 원자성을 검증하지 못한다. 앱 종료 시에는 직접 숨겨 둔 클라이언트가 아니라 기존 애플리케이션 close 경로를 사용해 `PrismaModule`의 연결 소유권을 유지한다. 이 원고 작성에서는 PostgreSQL 마이그레이션과 위 테스트를 실행하지 않았으며, 서술한 값은 재현할 기대 결과다.

이제 FluoBlog에는 비밀번호를 공개하지 않고 사람을 식별할 수 있는 계정 경계가 생겼다. 그러나 요청마다 비밀번호를 보내고 비싼 해시를 수행할 이유는 없다. 다음 장에서는 한 번의 로그인 결과를 짧은 수명의 토큰으로 표현하고, 그 토큰을 받았다는 사실과 현재 유효한 로그인 상태라는 판단을 분리한다.

## 근거와 더 읽을 소스

- [Prisma 등록·트랜잭션·수명주기 계약](../../packages/prisma/README.ko.md)
- [Prisma 공개 export](../../packages/prisma/src/index.ts)
- [모듈 등록과 전역 가시성 구현](../../packages/prisma/src/module.ts)
- [현재 트랜잭션과 클라이언트 수명주기 구현](../../packages/prisma/src/service.ts)
- [서비스 트랜잭션 경계 테스트](../../packages/prisma/src/vertical-slice.test.ts)
- [종료와 활성 트랜잭션 경합 테스트](../../packages/prisma/src/lifecycle-race.test.ts)

[이전 장](./ch12-efficient-queries.ko.md) · [1권 목차](./toc.ko.md) · [다음 장](./ch14-authentication.ko.md)
