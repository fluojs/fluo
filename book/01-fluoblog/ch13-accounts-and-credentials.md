# Modeling Users and Credentials

<!-- book:volume=01-fluoblog;chapter=13 -->

[Previous: Keeping the List Fast as Posts Grow](./ch12-efficient-queries.md) | [Volume 1 Contents](./toc.md) | [Next: Verifying Login State](./ch14-authentication.md)

## When There Is More Than One Author

A fellow developer sends FluoBlog a message asking to contribute a post. The operator starts to share the administrator password, then stops. There would be no way to tell who had signed in with that password, and if one person left, everyone would need a new password. A post could store its author's name as a string, but the application must still recognize the same person after a name change. To keep posts for the long term, we need to separate the name shown on screen from the identifier used to determine ownership.

By the end of the previous chapter, the product has posts stored in PostgreSQL, publishing rules, and a list query path. This chapter adds accounts to that database. Rather than building a separate authentication server first, we establish a small feature boundary in `src/accounts/`. This boundary owns the person's identifier, the email key used to log in, and the data used to verify a password. `PostsModule` does not need to know anything about passwords. Even when the same blog later sells merchandise, an order's `customerId` will refer to the user ID created here. Becoming a customer is not a reason to create a second account table.

The application code in this chapter is an implementation to apply to the `fluo-blog` project you generated. It does not mean that the repository's `examples/fluo-blog` is a complete application with this database and account functionality. We use Node.js 24 and pnpm 10, continuing with the PostgreSQL connection and generated Prisma Client chosen in Chapter 10. The following schema is not a replacement for the entire existing file: it is an **application schema fragment to merge into `prisma/schema.prisma`**. Keep the existing generator and datasource.

## People and Passwords Have Different Lifetimes

Using an email address as a user ID may look like a shortcut. But changing an email address then means changing post foreign keys, and reusing an address can link another person to someone's past posts. Use an opaque, stable string for the ID, and keep the email address as a changeable login identifier. A password can be reset or discarded while the account and its posts must remain. That is why we put the verification data in a separate table.

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

Add `authorId String` and `author User @relation(fields: [authorId], references: [id], onDelete: Restrict)` to `Post`. Keep the post's `id`, `title`, `content`, `slug`, `status`, `version`, and `publishedAt` unchanged. The string type of `authorId` must match `User.id`. If `authorId` already exists, connect the actual IDs and foreign key rather than adding a duplicate field. The editing example in a later chapter uses positive integers for post IDs and strings, including existing IDs, for user IDs. These two kinds of identifier do not need to have the same shape.

The optional `credential` relation does not permit a passwordless account partway through registration. The password registration path we are implementing creates both rows together. The optional relation represents an account whose password has been discarded during its lifetime, and also lets us retain the same `User.id` if we later introduce an external authentication method. The current login implementation does not authenticate an account with no credential.

The existing `authorId` is already a required string, so do not recreate it as a nullable column or replace all its values with UUIDs. `author-1` is a valid existing user ID; only new registrations receive the UUID default. Generate the following development migration.

```bash
pnpm exec prisma migrate dev --name add_accounts --create-only
```

Keep the generated SQL that creates `User` and `PasswordCredential`. Replace the automatically generated statement adding `Post_authorId_fkey` with the block below, creating the existing operator's row before adding the foreign key. Run this against the exercise database with writes stopped. If other author IDs exist, prepare account rows matching their actual ownership first; do not hide missing mappings by arbitrarily assigning them to the operator.

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

The existing seed's `Post.id=1`, `authorId=author-1`, `version=2`, publication time, and `PostPublication.actorId` do not change. The temporary operator account has no password and is `disabled`, so it cannot log in. The initialization below attaches credentials to this actual account exactly once. Do not accept `id=author-1` through public registration or make an arbitrary registrant the owner of past posts.

`onDelete: Restrict` prevents account deletion from cascading to post deletion. Password data may disappear with the account, but preserving published posts is a separate product policy. Here, account withdrawal or an operational restriction is represented by the `disabled` state rather than physical deletion. Retention periods for permanent deletion and anonymization are a separate concern; a disabled account must not be labeled as having completed personal data deletion.

## Input Normalization Is an Explicit Product Rule

If two registration requests submit `Writer@Example.com` and `writer@example.com`, should they create different accounts? FluoBlog treats them as the same login key. This is the product's registration rule, not a claim that every email system interprets them identically. This example accepts only ASCII email addresses, trims leading and trailing whitespace, and lowercases the entire address. It does not apply provider-specific rules such as removing dots or `+tag`. It also sends no email verification message, so the existence of an `emailKey` is not proof of ownership of that address.

The following is the **complete file `src/accounts/account-input.ts`**. Do not normalize passwords as you do email addresses. Trimming whitespace or applying Unicode normalization would make the stored secret differ from the one the user entered. The minimum length is a product policy against short passwords; the maximum is a boundary that limits resource use before hashing begins.

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

A display name is only a value to show to users, not an author ID in a URL or a key for permission comparisons. Do not convert it to an HTML string before storing it, either. HTML escaping belongs in the output context. Defining where each value is used keeps input validation from growing into a universal string-cleaning function.

## What Storing a Hash Actually Requires

If we keep a password as decryptable ciphertext, the login server can recover the original. Here, we compare by performing the same calculation with a candidate password without recovering the original. A single fast SHA-256 calculation is also fast for large-scale guessing. We use Node's asynchronous `scrypt` to impose memory and CPU costs and generate a random salt for each user. Fluo's Prisma registration does not do this for us.

The following is the **complete file `src/accounts/password-hasher.ts`**. The storage-format version `scrypt-v1` identifies the cost settings. We do not read and execute arbitrary costs from an external string, so a corrupted stored value cannot demand unbounded memory allocation. When changing the cost, design a new version and a verification path for the old version rather than changing what the same version name means.

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

`dummyHash` is not a real user's password. It is comparison data that lets us perform hashing at the same cost even when an account lookup finds nothing. This calculation alone does not make login response times perfectly equal. Database caches, scheduling, and the network also affect timing. What matters is not skipping the most expensive step entirely just because an account does not exist. A corrupted stored hash is surfaced as an internal error rather than quietly hidden as an ordinary login failure. Operators need to distinguish damaged credentials from an incorrect password.

The asynchronous `scrypt` API does not block the event loop directly, but that does not mean it can handle unlimited requests. Its calculations consume host resources, and running many at once increases login latency. The costs above are an explicit starting point for a learning implementation, not appropriate values for every server. Choose them by measuring on the actual CPU and at the expected number of concurrent logins; Chapter 16 limits how many requests reach hashing. Reducing the cost drastically to shorten login latency also reduces the cost of guessing after a data breach.

## Create Both Rows Together and Expose Only What Is Needed

Even if we check for a duplicate email with `findUnique` before registration, two requests can both see an empty result at the same time. The unique constraint on `emailKey` is the final authority for preventing duplicates. A successful registration consists of creating `User` and `PasswordCredential` together. A Prisma nested write avoids committing an intermediate state in which the user exists but saving the password failed. Compute the password hash before opening a database transaction.

The following is the **complete file `src/accounts/accounts.service.ts`**. The generated Prisma Client must include the models above. We distinguish `AccountView`, the public registration response, from `AuthenticatedAccount`, the internal data passed to the authentication module. Choosing the return fields with `select` from the start is safer than returning an entire Prisma row and then removing sensitive fields in the controller.

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

The duplicate-error branch assumes a schema in which `emailKey` is the only user-input unique key that this registration write can violate. If we later add another unique input, such as a nickname, we must update the error classification too. Converting every database error into a registration duplicate would blame users even for connection failures. Keeping raw hashes and SQL parameters out of error messages is part of the same boundary.

A class with correct types still will not run if module registration is missing. Below is the **complete file `src/accounts/accounts.module.ts`**. The class implementing `PasswordHasher` is itself the actual DI token. Writing an interface name in a constructor does not make it injectable.

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

The entire application shares one database registration. The following is the **complete registration file `src/app.ts`**. It imports the same `BlogDatabaseModule` from Chapter 10's `src/database/blog-database.module.ts`, which receives `AppSettings` through injection and creates a client per container. We add only `AccountsModule` and retain the existing OpenAPI configuration.

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

Here, `global` is a deliberate choice so accounts and posts can see the same database provider. A product needing multiple databases could use named registrations and explicit import boundaries, but we do not need them yet. `strictTransactions` prevents a fake client with no transaction capability from running as though it provided atomicity. `PrismaModule` manages connections and shutdown, but does not generate or apply schemas or migrations.

## Attach Credentials to the Existing Operator Account

This is the **complete `src/accounts/initialize-operator.ts`**, to be run locally only by the actual operator after migration. Supply the secret inputs `OPERATOR_EMAIL`, `OPERATOR_DISPLAY_NAME`, and `OPERATOR_PASSWORD` through the process environment; do not print them or put them in source code. The conditional update and credential creation commit together, and a rerun fails.

```ts
import { Inject, Module } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { bootstrapApplication } from '@fluojs/runtime';
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
  ) {}

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
class OperatorInitializationModule {}

export async function initializeOperator() {
  const app = await bootstrapApplication({ rootModule: OperatorInitializationModule });
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

The **complete `src/initialize-operator.ts`** prepares metadata first, then runs the function above. Transform this entry point with the same standard-decorator build settings as the application and run the generated JavaScript once on Node.js 24. It does not start an HTTP server or a second Prisma registration.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
const { initializeOperator } = await import('./accounts/initialize-operator.js');
await initializeOperator();
```

After initialization, `user.id` in Chapter 14's login result and the ID from `/auth/me` must be `author-1`. A new contributor's ID is a separate string. Post and publication-record counts and versions must be the same before and after initialization, and rerunning the initialization must not change the password. Running the pre-account tests from Chapters 10-12 against this schema also requires the operator row from this migration; test cleanup does not remove the account seed.

## State Changes Are Part of Authentication Policy

If a user can keep editing posts with an already issued token after the operator suspends the account, adding a `status` column is not enough. The `authVersion` introduced here represents the account-wide authentication generation. When changing a password or logging out every session, increment this number along with the verification-data change. The next chapter's tokens carry the number at issuance. If it differs from the current value when a request is authenticated, the token is considered outdated.

For example, a password change must first compute the new hash, then run `current().passwordCredential.update` and `current().user.update` inside one `prisma.transaction`. If the second write fails after the first, both must roll back. Do not connect this internal operation to a public change API that does not recheck the old password. This chapter implements registration and verification, not password-reset emails or a public password-change route. Adding a URL called `/reset` without a design for safely storing reset tokens does not complete the feature.

A single number cannot log out just one device. It is concise when every device should be disconnected together, but a per-device session list requires separate session IDs and persistent storage. Make the choice with that distinction in mind. A lookup showing an active account is not valid forever, either. If a suspension commits immediately after authentication is checked, one already running request may continue. The next chapter reflects suspension from the next authentication decision onward; particularly strict write blocking would require extending the design to a serialization policy for account state and write transactions.

## Experiments That Make Failures Visible

First, we can check hashing without a database. Below is the **complete test file `src/accounts/password-hasher.test.ts`**. Run it on Node.js 24 with the project's existing Vitest configuration. Since time itself is not the subject of the test, millisecond-level performance is not a success criterion.

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

Registration atomicity and duplication need to be checked against real PostgreSQL. Apply the schema to a development database not shared with other tests, then resolve `AccountsService` from the application container. Call `register` twice concurrently with `Promise.allSettled`, using different display names and the same normalized email address. Expect one success, one `AccountConflictError`, one `User` row for that email, and one related `PasswordCredential` row. Running requests only in sequence cannot reproduce the race between the duplicate check and the write.

Next, compare the correct password, an incorrect password, a nonexistent email address, a disabled account, and an account with no credential row. Only success should yield `id`, `displayName`, and `authVersion`; the other cases must return `null`. An invalid input format produces `AccountInputError`. The HTTP layer maps this distinction in the next chapter without revealing account existence through failure responses. Also verify that serializing a successful registration object includes none of `passwordHash`, `emailKey`, or `credential`.

To check a partial failure in a real nested row write, introduce a test-only PostgreSQL constraint that rejects credential insertion, then query to confirm that no user row remains either. Replacing this with a count of `create` calls on a fake client does not verify database atomicity. On shutdown, use the existing application close path rather than a separately hidden client, preserving `PrismaModule`'s ownership of the connection. The PostgreSQL migration and the tests above were not run while writing this manuscript; the values described are expected results for you to reproduce.

FluoBlog now has an account boundary that can identify people without exposing passwords. But there is no reason to send a password and perform expensive hashing on every request. The next chapter expresses a successful login as a short-lived token, separating possession of that token from the judgment that the login is currently valid.

## Evidence and Further Source Reading

- [Prisma registration, transaction, and lifecycle contracts](../../packages/prisma/README.md)
- [Prisma public exports](../../packages/prisma/src/index.ts)
- [Module registration and global visibility implementation](../../packages/prisma/src/module.ts)
- [Current transaction and client lifecycle implementation](../../packages/prisma/src/service.ts)
- [Service transaction boundary tests](../../packages/prisma/src/vertical-slice.test.ts)
- [Shutdown and active-transaction race tests](../../packages/prisma/src/lifecycle-race.test.ts)

[Previous Chapter](./ch12-efficient-queries.md) | [Volume 1 Contents](./toc.md) | [Next Chapter](./ch14-authentication.md)
