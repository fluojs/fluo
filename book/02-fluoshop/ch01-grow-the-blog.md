# Adding a Shop to the Existing Blog

<!-- book:volume=02-fluoshop;chapter=01 -->

[Previous: Volume 1 - The First Release and Operations Retrospective](../01-fluoblog/ch24-first-release.md) - [Volume 2 Contents](./toc.md) - [Next: Separating Content, Catalog, and Order Boundaries](./ch02-domain-boundaries.md)

## A Second Product That Began in the Comments

When FluoBlog first opened, the number its operator watched was the count of published posts. Now familiar readers return whenever a new post goes live, and people who arrive through subscription notifications read older posts as well. One day, purchase inquiries gather beneath a photo of a logo T-shirt in a retrospective post. A comment asking, "Can I buy stickers with it?" is not a request to abandon the blog and rebuild it as a shopping site. Readers want to buy things in the place they already trust and visit.

That is why the working directory for this volume is still `fluo-blog`. We keep `src/app.ts`, `src/main.ts`, `AccountsModule`, and `PostsModule` from Volume 1. The PostgreSQL connection, login verification, configuration, request identifiers, observability, and shutdown procedures continue as well. FluoShop is a new role for the product, not the name of a new account system or a separate deployment. We do not begin by running a command to create another application and copying the existing user data.

A successful blog is not automatically a shop ready to sell, however. Changing a post title is different from preserving the name of a T-shirt at the time of purchase. A deleted post can disappear from public listings, but discontinuing a product must not make items disappear from past orders. Two features do not share a lifecycle simply because they run in the same process. In this chapter, we make room for products before that distinction grows more complicated and learn to add new data without damaging the existing blog.

The completed state of this chapter is not a shop that can accept payments. It is the existing application, with its posts and accounts intact, plus an independent product model and a public read service. We add prices and sizes in Chapter 3 and the screens readers will visit in Chapter 4. This sequence is different from leaving empty functions where the core work belongs. The reads provided here actually work; they do not simulate a successful purchase feature that we have not yet promised.

The code in this book is implementation for readers to apply to their own applications. It does not mean that the repository already contains a separate checkpoint with a complete application for each chapter. The existing `examples/fluo-blog` provides executable evidence for the early HTTP and DI paths, not a complete repository supplying the product tables or shop services below.

## Decide What Must Be Preserved First

At the first design meeting for the product feature, write down the identifiers that must not change before discussing new data. An account ID stays the same when a reader becomes a customer. The user verified through the existing JWT subject must be the same user referenced by an order's `customerId`. Creating a shop-specific `Customer` table and loosely linking it to an existing account by email address splits one person into two whenever email changes, case handling, or account merging comes into play. Extend the account with separate, linked information for customer shipping needs, but do not create a new login identity.

Preserve the meaning of posts as well. `id`, `authorId`, `title`, `content`, `slug`, `status`, `version`, and `publishedAt` still describe the rules of content. Do not add `sold_out` to a post's `status` just because it introduces a product. A post can be published while the merchandise is out of stock, and a retrospective about a discontinued item can remain worth reading. Combining the two states could make a post disappear for readers arriving from search as soon as the operator tidies up inventory.

It is easy to miss this coupling if you implement the new requirement starting with the screen. Adding `price` and `stock` columns to a post and interpreting "has a price" as "is a product" is fast at first. But if several posts introduce the same T-shirt, or one post links to both a T-shirt and stickers, you can no longer tell which price and stock count is authoritative. Permission to write posts can also spill over into permission to change selling prices. This time, separate them from the outset: posts introduce products, and products exist under their own identifiers.

Prepare a baseline for comparing the application before and after release. Record the ID and URL of one published post, the private status of one draft, one existing reader's ID, and whether login succeeds. This does not mean recording password hashes or raw tokens. Keep non-secret observations that let you check whether the same requests retain their meaning after the product migration. "The shop page opens" is not enough to establish that the blog extension succeeded.

## Add One Product Table

The first product is a logo T-shirt. The following is a **schema fragment to add** to `prisma/schema.prisma`. Preserve the existing `generator`, PostgreSQL `datasource`, and post and account models. The application owns these models; `@fluojs/prisma` does not generate them automatically.

```prisma
enum ProductStatus {
  draft
  published
  archived
}

model Product {
  id      String        @id @default(cuid())
  slug    String        @unique
  name    String
  status  ProductStatus @default(draft)
  version Int           @default(1)

  @@index([status, id])
}
```

We separate `id` from `slug` because an address and an identity change at different rates. Use an unchanging ID for internal references and a slug for human-readable addresses. Renaming "First Logo T-shirt" to "Fluo Logo T-shirt" does not make it a different product. Changing a slug requires a separate policy for preserving old links, so we keep `fluo-logo-tee` in this exercise.

`draft` means a product is not yet included in the public listing, `published` means it has been selected for public visibility, and `archived` means it has been removed from the sales listing but retained. Here, `published` does not guarantee remaining stock or the ability to accept payment. There is no inventory model in this chapter, and Chapter 3 also excludes products without actual sales units from public reads. Keep the term's scope narrow so that another layer does not use product status alone as grounds for an inventory reservation.

`version` is not a signal to apply optimistic locking to every read immediately. It provides a place in the data to distinguish conflicting changes. Later update operations can use the version they read as an update condition and increment it on success. A counter that always increments without checking for conflicts does not solve concurrent updates. The reads in this chapter do not need the version, so we do not expose it in the response.

Create the migration against a development PostgreSQL database in the following order. First confirm that you are not using the production database URL. These commands are a reproduction procedure for the reader, not a record of execution during the writing of this manuscript.

```bash
pnpm exec prisma migrate dev --name add_catalog --create-only
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

Read the SQL generated by the first command before applying it. The expected changes are a new enum, the `Product` table, a unique constraint, and an index. Stop here if it includes deletion of existing post or account tables, unexpected changes to required columns, or data resets. The second command applies the migration to the development database, and the third generates a Prisma Client that knows about the new model. Generating the client does not replace changing the database, and the reverse is also true.

A change like this, adding a table unknown to the old code, coexists relatively well with an older application version. The old version does not read the new table even if it remains, so you can roll back just the application deployment. That does not mean every schema change is reversible. Removing existing columns or changing their meaning later requires a separate transition procedure. Rather than assuming "Prisma migrations make rollbacks automatic," check whether the current older version continues to work with the new schema.

## Share the Connection, Not the Features

A common mistake when adding a shop is creating a new `PrismaClient` inside `CatalogModule`. Posts and accounts already use a connection; adding a client for each feature multiplies connection pools and shutdown owners. Connecting to the same database does not automatically share transaction context either. This product uses the same PostgreSQL database and the same Prisma registration.

The connection belongs to `src/database/blog-database.module.ts` from [Volume 1, Chapter 10](../01-fluoblog/ch10-prisma-persistence.md). The following **revisits the existing registration file**; it is neither a new file nor a second registration. It receives the existing `AppSettings` provided globally by `AppSettingsModule` and creates a client for each application container. Do not create a new module-level `prisma` variable or wrap it in a `DatabaseModule` class.

```ts
// src/database/blog-database.module.ts
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { AppSettings } from '../config/app-settings.js';

export const BlogDatabaseModule = PrismaModule.forRootAsync({
  global: true,
  inject: [AppSettings],
  useFactory: (settings: unknown) => {
    if (!(settings instanceof AppSettings)) throw new Error('Expected AppSettings from DI.');
    return {
    client: new PrismaClient({
      datasources: { db: { url: settings.databaseUrl } },
    }),
      strictTransactions: true,
    };
  },
});
```

The root `src/app.ts` keeps its existing `AppSettingsModule` and `BlogDatabaseModule` registrations. `PostsModule` and `AccountsModule` continue using that global service. Even when you explicitly declare dependencies in imports, as in the catalog module below, reference only the same `BlogDatabaseModule` object from this file. Do not call `forRoot` or `forRootAsync` again in each file. Referencing the same registration object is different from creating a new registration with the same options. The latter can separate providers and connection lifecycles.

`strictTransactions: true` prevents the helper from falling back to direct execution when a client does not support transactions. It is not an option that adds transactions or locks to every read. The current listing query does not need a manual transaction, but the order and inventory composition later requires the active transaction context provided by this same registration.

This application has already chosen an unnamed registration with `global: true`. `global` is an outer module visibility option, not a client option returned by the factory. An explicit import in a feature module records its dependency on the same registration; it does not create a separate connection. Do not remove the global registration or add a new wrapper that changes the account and post configuration from Volume 1.

The following two code blocks are each a **complete file**. The Prisma Client generated earlier and `src/database/blog-database.module.ts` must be ready.

```ts
// src/catalog/catalog.reader.ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class CatalogReader {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async list() {
    return this.db.current().product.findMany({
      where: { status: 'published' },
      select: { id: true, slug: true, name: true },
      orderBy: { id: 'asc' },
      take: 24,
    });
  }
}
```

```ts
// src/catalog/catalog.module.ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CatalogReader } from './catalog.reader.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [CatalogReader],
  exports: [CatalogReader],
})
export class CatalogModule {}
```

A constructor type annotation alone does not establish injection. `@Inject(PrismaService)` declares the actual runtime token at class level. `providers` registers `CatalogReader` for this module to create, and `exports` exposes its read capability to other modules that import this one. In contrast, `PrismaService` is not re-exported as part of the catalog module's public API. Another feature has no reason to receive the catalog module's database access merely to read products.

`current()` returns the active transaction client if one exists, or the root client otherwise. Obtain the handle when the method is called for that reason. If you call `current()` once in the constructor and save it in a field, the service may use that previously captured root handle even when called inside a transaction later. This is only a simple read today, but this small choice avoids breaking future composition.

The query specifies public status, public fields, and a maximum result count together. Because it does not return entire database rows, administrative status and future internal fields are not exposed automatically. The limit of 24 is the initial shop's display limit, not a complete pagination contract. Once the data exceeds it, you need a separate browsing feature. Using a fixed ID order rather than sorting by name reduces unexpected changes in order when a name is edited.

In `src/app.ts`, add `CatalogModule` to `imports` in the existing `@Module` declaration. The following is a **metadata fragment showing only the change point**. Do not remove the already registered configuration, observability, and readiness modules and replace them with this list. `AccountsModule` refers to the export from `src/accounts/accounts.module.ts`, `PostsModule` to the export from `src/posts/posts.module.ts`, and `CatalogModule` to the export from the file just created.

```ts
({
  imports: [AppSettingsModule, BlogDatabaseModule, AccountsModule, PostsModule, CatalogModule],
})
```

Do not create a new HTTP server or a second `main.ts`. The existing startup path initializes the module graph, and the existing shutdown path closes the Prisma connection. The Prisma integration owns the connection and disconnection lifecycle of registered clients, so do not call `$connect()` in a catalog service constructor or `$disconnect()` at the end of a request.

## Observe Failures Before Putting the Name on Display

The first experiment works without a database. The following is the **complete test file** `src/catalog/catalog.metadata.test.ts`. It uses the Vitest setup and standard-decorator test transforms established in Volume 1. Importing the registration object alone does not execute `useFactory`. This checks only module metadata and registration identity, without initializing an actual container.

```ts
import { getModuleMetadata } from '@fluojs/core';
import { expect, it } from 'vitest';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CatalogModule } from './catalog.module.js';
import { CatalogReader } from './catalog.reader.js';

it('imports the shared database and exports only catalog reads', () => {
  const metadata = getModuleMetadata(CatalogModule);

  expect(metadata?.imports).toContain(BlogDatabaseModule);
  expect(metadata?.providers).toContain(CatalogReader);
  expect(metadata?.exports).toEqual([CatalogReader]);
});
```

This experiment proves the module declaration, not a successful database connection. Removing the shared registration from `imports` must make the first assertion fail. You must subsequently start the actual application and resolve the path that uses `CatalogReader` to check visibility between modules as well. Passing a declaration check is not a reason to skip bootstrap or SQL checks.

Register one draft T-shirt in the development database. The following is the **complete function file** `src/catalog/seed-catalog.ts`. Resolve and pass the root registration's `PrismaService` from the existing development execution boundary; do not call it on every server startup. This function neither creates nor closes a connection. `update: {}` is an intentionally empty update that avoids overwriting the name and publication status edited by the operator when the function runs again.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export async function seedCatalog(db: PrismaService<PrismaClient>) {
  return db.current().product.upsert({
    where: { slug: 'fluo-logo-tee' },
    update: {},
    create: {
      slug: 'fluo-logo-tee',
      name: 'Fluo Logo Tee',
      status: 'draft',
    },
  });
}
```

The next observations are a manual reproduction procedure requiring a real PostgreSQL database. With only one draft present, `CatalogReader.list()` must return an empty array. Changing that product to `published` in the development database should produce one item containing only `id`, `slug`, and `name`. Changing it to `archived` should make it disappear again while the row remains. Trying to create two new rows with the same slug must have the duplicate rejected by the unique constraint. Even if two concurrent create requests both read "absent," the database constraint makes the final decision.

Then shut down the application normally and restart it. The T-shirt and existing posts must remain, and logging in as the existing reader must still return the same account ID. Because hiding products is distinct from deleting data, blog URLs must remain live even when the product listing is taken down. Forcing the seed to run at restart to pass this test recreates the data; it does not prove persistence.

Distinguish partial failures as well. If the migration has been applied but the client has not been generated, TypeScript may not recognize the `product` model. If the client is new but the database still has the old schema, the actual query fails. Turning either failure into an empty product list makes an outage look like a normal state. Send unexpected database errors through the existing error and observability paths, and use "no products on display" only when a successful query returns zero rows.

The tests and database experiments in this chapter are procedures for readers to perform after assembling the application above. Checking the manuscript's links and code structure is separate evidence from verifying a real PostgreSQL connection. This document does not claim to have run and passed the latter.

## Operational Boundaries Within the Same Deployment

The sales screen is not public yet, which helps with deployment. You can apply the additive schema first, check that the application containing the new read code still handles existing blog requests, and then decide whether to expose the feature. A product in `draft` does not appear in the listing either. Because visibility is part of the query conditions rather than controlled by a single UI link, you also reduce the chance that someone who knows the link can bypass it to read a draft.

The `draft` filter does not replace authorization, however. We do not open an administrative HTTP write path in this chapter. When you connect one, reuse the authentication identity and authorization decisions from Volume 1. Hiding a button in an admin screen, putting `isAdmin: true` in a request, or comparing a seller's email address is not server-side authorization.

A modular monolith has costs too. Because the process and database are shared, a product query that exhausts the connection pool can affect post reads as well. Listing limits, slow-query observability, and distinguishing errors by request are therefore necessary. That does not mean separating accounts, catalog, and orders into individual services on the day you register the first T-shirt makes the problems disappear. It gives you the costs of network failures, distributed deployments, data replication, and cross-service authentication first. This volume waits for a real requirement that justifies those costs, then separates only fulfillment in Chapter 23.

Do not expand even this small design unconditionally. If the only requirement were to direct readers to an external shop for one fixed merchandise item, a link in a post could be enough without a product database model. We added the model because the product will provide a cart and order history under the same account and handle inventory and orders itself. Implementation choices should follow the product scope already accepted, not every imaginable future possibility.

The blog now has products. But as the public `CatalogReader` gains methods, other features can easily start depending on catalog internals. In the next chapter, we separate the different relationships in which content introduces products and orders purchase them, then express those boundaries through DI tokens and module exports.

## Implementation References

- [`@fluojs/core` README](../../packages/core/README.md): Class-level `@Inject`, module metadata, and the standard-decorator contract.
- [core public exports](../../packages/core/src/index.ts), [module metadata tests](../../packages/core/src/module-defaults.test.ts): The actual public paths for `Module` and `getModuleMetadata`, and observations of their declarations.
- [`@fluojs/prisma` README](../../packages/prisma/README.md): Registration, `current()`, transactions, and shutdown ownership.
- [Prisma registration implementation](../../packages/prisma/src/module.ts), [registration option types](../../packages/prisma/src/types.ts), [registration tests](../../packages/prisma/src/module.test.ts): Evidence for non-global registration by default, service tokens, and `strictTransactions`.
- [Shared editorial and data contracts](../EDITORIAL.md), [finalized series contents](../series.json): Continuity of the same blog and the execution environment.

[Previous: Volume 1 - The First Release and Operations Retrospective](../01-fluoblog/ch24-first-release.md) - [Volume 2 Contents](./toc.md) - [Next: Separating Content, Catalog, and Order Boundaries](./ch02-domain-boundaries.md)
