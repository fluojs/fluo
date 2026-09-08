# Separating Content, Catalog, and Order Boundaries

<!-- book:volume=02-fluoshop;chapter=02 -->

[Previous: Adding a Shop to the Existing Blog](./ch01-grow-the-blog.md) - [Volume 2 Contents](./toc.md) - [Next: Modeling a T-shirt as a Product](./ch03-catalog-and-money.md)

## Editing a Post Changes the Purchase Record

Published FluoBlog posts are currently immutable. Keeping that policy in place, consider what could happen later if content and orders were designed to share the same current representation. If revision, unpublishing, or deletion features were introduced later and the order screen read product names and descriptions from that post every time, the screen for an already accepted order would change too. Making the post private or deleting it could even remove the evidence of what the customer bought. This chapter neither implements those content-changing features nor changes the existing publication policy. It separates data with different meanings so that future content changes cannot rewrite transaction records.

To solve this, you could have `PostsService` call `OrdersService` to preserve past orders, while `OrdersService` reads the current title from `PostsService` in return. Add product pricing and the services begin referencing one another. Splitting files into `content`, `catalog`, and `orders` folders does not create boundaries if constructor dependencies and write permissions remain tangled. Directories mark boundaries; they are not the boundaries themselves.

What we decide in this chapter is not the number of services but who can make changes and what each feature publicly promises. Content owns publishing and editing posts, catalog owns current information describing what is for sale, and orders own a transaction requested by a particular customer under particular conditions. Accounts remain in the `AccountsModule` from Volume 1. We do not replicate the account table or authentication service in each feature just because "they all know the same customer."

We do not implement order acceptance yet. Instead, we build a small working feature that consumes product information: `CatalogPromotion`, which constructs links to products beneath a published post. Even this modest requirement gives us enough experience choosing which types to expose between producer and consumer, connecting interfaces at runtime, and deciding what to replace in tests. After verifying that boundary, we can extend it to the stronger contract of orders.

## Owning a Row Is Different from Reading Its Values

If your only question when defining domain boundaries is "Who reads this data?", almost every feature becomes connected. An operations dashboard may read accounts, posts, products, and orders alike. A more useful question is "Who decides what constitutes a valid change?" The catalog feature owns the policy for changing a product name. It does not have the authority to decide whether that change should also update snapshots in past orders.

| Area | Decisions it owns | Values it provides to other areas | What other areas must not do directly |
| --- | --- | --- | --- |
| `PostsModule` | Writing, publishing, and editing permissions; whether drafts are public | Representations of published posts | Bypass the rules to update a post's database state |
| `CatalogModule` | Product publication, SKUs, and current prices | Public products and, later, current information for purchasing | Write arbitrary prices to product tables |
| `OrdersModule` | Order acceptance, snapshots, and permitted state transitions | Order status visible to the customer | Propagate product name changes into past orders |
| `AccountsModule` | User identification and existing account rules | Verified user IDs and necessary public information | Trust `customerId` in a request body as the login identity |

In a modular monolith sharing one PostgreSQL database, you can read other tables at the SQL level. That capability is not automatically an allowed dependency. Once an order service begins calling `prisma.product.update()`, product change rules split across two places. Directing product updates through the catalog service makes the location of those rules clearer than hiding every SQL operation behind a generic repository.

This does not mean eliminating every reference. Passing a product ID to another feature or recording a SKU in an order is normal collaboration. The important distinction is whether you reread the current row to reconstruct its meaning or preserve the facts at that moment in your own data. A recommendation link beneath a post may use the current product name. An order item's SKU, unit price, quantity, and discount, however, must be snapshots taken at order time. Grouping both under the name "read product information" loses this distinction.

When orders are introduced, `id`, `customerId`, `status`, `currency`, `totalMinor`, and `version` become that area's core data. The states are based on `pending_payment`, `paid`, `fulfilling`, `shipped`, `cancelled`, `refund_pending`, and `refunded`; we do not create a state-change API that accepts any arbitrary string. Inventory reservations have a lifecycle separate from order status. For now, we are defining this ownership, not claiming to have implemented an order engine or distributed transactions.

## A Small Public Contract for Catalog Reads

In the previous chapter, `CatalogModule` exported the `CatalogReader` class directly. That is a reasonable starting point when there is only one read operation. But the consumer needs "the ability to read a short list of public products," not a class that uses Prisma. Even if administrative or SKU queries are added later, recommendation links in posts do not need access to every method.

The following is the **complete file** `src/catalog/catalog.port.ts`. `CatalogCard` is a public read contract, not a database entity, and this chapter's product cards do not yet contain amounts. We will explicitly extend this contract when adding sales units in the next chapter.

```ts
export type CatalogCard = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
};

export interface CatalogListing {
  list(): Promise<readonly CatalogCard[]>;
}

export const CATALOG_LISTING = Symbol('fluo-blog.catalog.listing');
```

Interfaces are used for TypeScript checking and do not survive into the runtime output. Therefore, `@Inject(CatalogListing)` does not work. We need the `CATALOG_LISTING` token, which actually exists at runtime. Recreating this symbol in each file with the same description string creates different tokens. Every consumer must import the single export from this file. A symbol's description makes logs easier to read; it does not determine equality.

This token is not an abstraction introduced for the vague reason that "we might change databases later." We introduce it to narrow the capabilities a real consumer receives and to replace that read boundary in tests. A generic repository interface containing `save`, `delete`, and `findEverything` would work against that purpose. Internal code that needs only one concrete class can continue injecting that class directly.

The previous chapter's `CatalogReader` already implements `list()`. Add the type import to `src/catalog/catalog.reader.ts` and `implements CatalogListing` to the class declaration. The following **complete file** includes the change while preserving the existing injection and query behavior.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { CatalogListing } from './catalog.port.js';

@Inject(PrismaService)
export class CatalogReader implements CatalogListing {
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

Next, replace `src/catalog/catalog.module.ts` with the following **complete file**.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CATALOG_LISTING } from './catalog.port.js';
import { CatalogReader } from './catalog.reader.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    CatalogReader,
    { provide: CATALOG_LISTING, useExisting: CatalogReader },
  ],
  exports: [CATALOG_LISTING],
})
export class CatalogModule {}
```

`useExisting` aliases the already registered `CatalogReader` instance. Registering both `CatalogReader` and `{ provide: CATALOG_LISTING, useClass: CatalogReader }` can create separate instances through the two provider paths. That difference is hard to notice in a stateless reader like this one, but caches or disposal hooks can make it much more confusing. `useExisting` matches the intention to expose one implementation under another name.

Because `exports` now contains just one symbol, update the previous chapter's metadata test to reflect the intent. Continue checking that `CatalogReader` is a provider, and change the expected exports to `[CATALOG_LISTING]`. This is not weakening a failing test; it is reflecting a deliberate change to the public contract. Do not keep exposing the class directly while describing it as "exposing only the interface."

## Introduce Products in Posts Without Owning the Posts

Rather than having content import catalog and catalog import content in return, place the screen composition that connects them at a higher level. `src/storefront` owns no new accounts or product entities. It uses posts already approved for publication and public products to build a representation for readers. The following is the **complete file** `src/storefront/catalog-promotion.ts`.

```ts
import { Inject } from '@fluojs/core';
import {
  CATALOG_LISTING,
  type CatalogListing,
} from '../catalog/catalog.port.js';

export type PostPublication = {
  readonly id: number;
  readonly status: 'draft' | 'published';
};

export type ProductLink = {
  readonly productId: string;
  readonly label: string;
  readonly href: string;
};

@Inject(CATALOG_LISTING)
export class CatalogPromotion {
  constructor(private readonly catalog: CatalogListing) {}

  async forPost(post: PostPublication): Promise<readonly ProductLink[]> {
    if (post.status !== 'published') {
      return [];
    }

    const products = await this.catalog.list();
    return products.map((product) => ({
      productId: product.id,
      label: product.name,
      href: `/products/${encodeURIComponent(product.slug)}`,
    }));
  }
}
```

`PostPublication` does not redefine the post entity. It is an input type exposing only the two fields this composition uses from the Volume 1 post object. `id` is the existing post ID; neither the author nor the body is copied. The actual caller must be server code that has already completed the existing post read and publication decision. This is not a path for exposing a private post because a client submitted `status: 'published'`.

For a draft, return an empty array immediately. This expresses the current product policy of not attaching products to draft previews, while avoiding an unnecessary catalog query. If the policy changes, we can design separate preview inputs and permissions. Do not force administrator-token checks into `forPost()`. Existing boundaries handle authentication and content publication decisions; this composition uses the facts it receives.

Encode the slug when inserting it as a single URL segment. Even though the current slug rules are simple, keep URL construction in this one place. Returning structured `label` and `href` values rather than concatenating HTML strings leaves actual rendering to the React component in Chapter 4. A DI service has no reason to know how symbols in a product name should be represented in HTML.

Keep registration alongside the composition too. The following is the **complete file** `src/storefront/storefront.module.ts`. Add this module to the existing imports in `src/app.ts`. Do not register the catalog module's internal classes again in another module's providers.

```ts
import { Module } from '@fluojs/core';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogPromotion } from './catalog-promotion.js';

@Module({
  imports: [CatalogModule],
  providers: [CatalogPromotion],
  exports: [CatalogPromotion],
})
export class StorefrontModule {}
```

The direction so far is `StorefrontModule -> CatalogModule -> BlogDatabaseModule`. If the existing server-side content screen composition needs `CatalogPromotion`, it imports `StorefrontModule`. The catalog module need not know that a post screen exists. When orders are added later, do not have the catalog inject an order screen in the reverse direction either. A higher-level composition knowing several features is normal; every feature knowing every other feature is different.

## Open a Container and Experiment with the Boundary

Explanation alone does not make the effect of symbol tokens easy to feel. The following is the **complete test file** `src/storefront/catalog-promotion.test.ts`. It uses the real `Container` and the real `CatalogPromotion`, replacing only the public read port instead of connecting to a database. The test double does not simulate transactions or inventory, so we do not claim it verifies those behaviors.

```ts
import { Container, DuplicateProviderError } from '@fluojs/di';
import { expect, it } from 'vitest';
import {
  CATALOG_LISTING,
  type CatalogListing,
} from '../catalog/catalog.port.js';
import { CatalogPromotion } from './catalog-promotion.js';

it('uses the public catalog port to build product destinations', async () => {
  const catalog: CatalogListing = {
    async list() {
      return [{
        id: 'product-tee',
        slug: 'fluo-logo-tee',
        name: 'Fluo Logo Tee',
      }];
    },
  };
  const container = new Container().register(
    { provide: CATALOG_LISTING, useValue: catalog },
    CatalogPromotion,
  );

  try {
    const promotion = await container.resolve(CatalogPromotion);
    const links = await promotion.forPost({ id: 1, status: 'published' });

    expect(links.map((link) => [link.productId, link.href])).toEqual([
      ['product-tee', '/products/fluo-logo-tee'],
    ]);
  } finally {
    await container.dispose();
  }
});

it('does not read the catalog for a draft post', async () => {
  const catalog: CatalogListing = {
    async list() {
      throw new Error('Unexpected catalog access');
    },
  };
  const container = new Container().register(
    { provide: CATALOG_LISTING, useValue: catalog },
    CatalogPromotion,
  );

  try {
    const promotion = await container.resolve(CatalogPromotion);
    await expect(promotion.forPost({ id: 1, status: 'draft' }))
      .resolves.toEqual([]);
  } finally {
    await container.dispose();
  }
});

it('requires an explicit override for an existing token', async () => {
  const emptyCatalog: CatalogListing = {
    async list() { return []; },
  };
  const container = new Container().register({
    provide: CATALOG_LISTING,
    useValue: emptyCatalog,
  });

  try {
    expect(() => container.register({
      provide: CATALOG_LISTING,
      useValue: emptyCatalog,
    })).toThrow(DuplicateProviderError);

    container.override({
      provide: CATALOG_LISTING,
      useValue: emptyCatalog,
    });
    expect(await container.resolve(CATALOG_LISTING)).toBe(emptyCatalog);
  } finally {
    await container.dispose();
  }
});
```

The first test checks destinations and product identifiers. It does not pin the wording of product names. The second fails immediately if a draft triggers a catalog read. It makes an incorrect crossing of the boundary clearer than a double that merely counts calls. The third shows that `register()` is not a replacement API. Do not register the same token again in every test and expect the last value to happen to win.

Run the tests with `pnpm exec vitest run src/storefront/catalog-promotion.test.ts`. This assumes Node.js 24 and pnpm 10 with the existing standard-decorator test transforms preserved. The expected result is three passing tests; using a different symbol in `@Inject` should make the first consumer resolution fail. This does not mean that these application files were actually created and executed while writing this manuscript.

This unit experiment does not verify module visibility. A test that registers everything flatly with `new Container().register()` has no `imports` and `exports` graph. The actual application therefore also needs a startup experiment that resolves the consumer through `StorefrontModule`. If removing the token from `CatalogModule`'s exports still lets the application provide the same path, check whether a provider has been made global or registered again somewhere. Unit-test convenience must not hide omissions in the production composition.

## Deferring a Cycle Does Not Remove It

An actual constructor cycle is one of the earliest signs that boundaries have broken down. The following is a **complete, isolated experiment** in `src/storefront/cycle.test.ts`. It is a test of failure behavior, not product code, so do not register it in an application module.

```ts
import { Inject } from '@fluojs/core';
import { CircularDependencyError, Container, forwardRef } from '@fluojs/di';
import { expect, it } from 'vitest';

@Inject(forwardRef(() => OrderSide))
class CatalogSide {
  constructor(readonly orders: OrderSide) {}
}

@Inject(CatalogSide)
class OrderSide {
  constructor(readonly catalog: CatalogSide) {}
}

it('rejects a real cycle even when token lookup is deferred', async () => {
  const container = new Container().register(CatalogSide, OrderSide);
  try {
    await expect(container.resolve(CatalogSide))
      .rejects.toThrow(CircularDependencyError);
  } finally {
    await container.dispose();
  }
});
```

`forwardRef()` delays looking up a class token that is not yet available at declaration time. It does not solve the problem that creating `CatalogSide` requires `OrderSide`, whose creation requires `CatalogSide` again. The expected result is `CircularDependencyError`, not successful resolution, and the test treats that rejection as success. The purpose of the experiment is to avoid normalizing constructor cycles under the name "bidirectional collaboration."

The solution is usually to change where collaboration takes place. Have a higher-level use case that reads catalog data and creates an order call the two in sequence, or extract a rule shared by both into a stateless value function. This does not mean turning every call into an event. Making an operation asynchronous when its result is needed immediately complicates checking the result and handling failures. The later chapters on asynchronous processing cover real requirements for events.

Lifecycle is part of the boundary too. If a default singleton service stores the current customer ID in a field, two requests share that instance. Start with the simpler form: pass the verified ID as a method argument. If request-specific state must be injected, use request scope explicitly. Fluo rejects a singleton that depends on a request-scoped provider with `ScopeMismatchError`; it does not automatically convert the singleton to request scope. Hiding an incorrect lifetime with `optional()` is not a solution either.

## The Right Boundaries Keep Changes Small

When a product name changes, the link's display name may change, but an order snapshot must not. If a catalog read fails, the product screen must reveal the failure, but the service reading the existing post body should not automatically call the catalog database too. Watching for new mandatory dependencies on existing read paths whenever you add a feature is the first step toward limiting failure propagation. If you want to omit supplementary recommendations during an outage, explicitly define the observability and failure policy rather than turning every error into an empty array.

Manage the number of abstractions as well. The one port and one screen composition added here are actually used and tested. Do not line up empty modules named orders, payments, and fulfillment in advance. Moving everything that looks shared into `CommonModule` creates a change point depended on by the largest number of features. Before sharing code, determine whether the duplication represents the same rule or merely code with a coincidentally similar shape.

By the end of this chapter, public catalog reads and composition of post presentation are separate. We have limited the capabilities available to other areas while keeping the operational choice of one process and one database. In the next chapter, we add actual sales units to this read contract. A T-shirt's name alone cannot tell us exactly what can be purchased or for how many won. SKUs, minor currency units, validation, and database constraints form the next boundary.

## Implementation References

- [`@fluojs/core` README](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts): Contracts for class-level injection and module declarations.
- [`@fluojs/di` README](../../packages/di/README.md), [DI public exports](../../packages/di/src/index.ts): `Container`, `useExisting`, `override`, request scope, and disposal.
- [Container tests](../../packages/di/src/container.test.ts): Evidence for actual registration, resolution, aliasing, replacement, and lifecycle behavior.
- [DI error implementation](../../packages/di/src/errors.ts), [circular dependency error tests](../../packages/di/src/circular-dependency-error.test.ts): The distinction between deferred token lookup and rejection of an actual cycle.
- [Module metadata tests](../../packages/core/src/module-defaults.test.ts): The scope a declaration check can verify.
- [Shared data contracts](../EDITORIAL.md): User identifiers, order states, and snapshot ownership.

[Previous: Adding a Shop to the Existing Blog](./ch01-grow-the-blog.md) - [Volume 2 Contents](./toc.md) - [Next: Modeling a T-shirt as a Product](./ch03-catalog-and-money.md)
