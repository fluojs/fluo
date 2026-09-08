# Building Document Models for Reviews and Products with MongoDB

<!-- book:volume=02-fluoshop;chapter=26 -->

[Previous: Implementing the Same Repository Contract with Prisma and Drizzle](./ch25-drizzle-lab.md) | [Table of Contents](./toc.md) | [Next: Observing a Sale Event and Finding Bottlenecks](./ch27-sale-observability.md)

## Readers' fit reviews are not order tables

A reader who received a logo T-shirt leaves a comment on FluoBlog: "The sleeves are longer than the description suggested. I'd like to read how it fits other people, too." The operator wants to gather material details, care instructions, sizing information, and reviews on the product page. T-shirts and stickers need different descriptive fields, and reviews keep growing even after a sale ends. Using order item snapshots as storage for this screen could let edits to product descriptions disturb historical orders.

This chapter does not begin with the conclusion that MongoDB is necessary. PostgreSQL's relational tables and JSON columns can also meet this requirement. The aim is to build a boundary in the same FluoShop where a document model is convenient, then examine the cost of that convenience: source tracking, sessions, duplicate handling, and read consistency. Like the previous chapter, this is a separate comparison lab. It does not move orders, payments, or inventory to MongoDB.

`CatalogModule` owns the authoritative product IDs and product description versions. Account IDs remain the same string IDs used in FluoBlog. A MongoDB product document is a display copy using this ID as its `_id`, and a review stores the same user ID as `authorId`. We do not add separate sign-up or create a new MongoDB user collection. We do not trust this copy to determine prices or saleable stock.

Place the lab files under `fluo-blog/src/catalog/review-lab/` in the application you created. The execution baseline is Node24 and pnpm10, with `@fluojs/mongoose` and `mongoose` required. The experiment below writes multiple documents atomically, so it requires a MongoDB replica set or an appropriately configured sharded cluster that supports transactions. Fluo's strict check for methods on the connection object and a check that the server can actually perform transactions are different checks. Successfully connecting to an independent standalone server does not satisfy the lab prerequisites.

## Why not put every review in one product?

The first document design puts `reviews: []` inside the product. It has two advantages: one product read can build the screen, and a single-document update is atomic. But as reviews accumulate for a popular product, the document grows without bound. There is no reason to handle the entire array just to show the 20 latest reviews on the first page, and every new review modifies the same large document. Write contention and response size can become problems before MongoDB's document size limit is reached.

Instead, the product document holds only bounded descriptive fields and review aggregates. Full reviews live in a separate collection. The product rule for this lab is "one user can write one review for one product," regardless of order quantity or repeat purchases. We do not add a verified-purchase badge. Displaying purchase status would require the server to check order ownership and shipping status and store that result as separate evidence; accepting a client-supplied `verified` value is not enough.

The following is the complete file `src/catalog/review-lab/models.ts`. Declaring `_id` as a string avoids mistaking the default ObjectId for an account ID. We limit field lengths and the number of specification entries and add a compound index for review lists. It is also important that a `unique` declaration does not replace an input validator. Uniqueness is guaranteed only when the actual database index exists.

```ts
import { Schema, type Connection } from 'mongoose';

export type Specification = { label: string; value: string };

export type ProductDocument = {
  _id: string;
  title: string;
  sourceVersion: number;
  specifications: Specification[];
  reviewCount: number;
  ratingTotal: number;
};

export type ReviewDocument = {
  _id: string;
  productId: string;
  authorId: string;
  rating: number;
  content: string;
  createdAt: Date;
};

export function registerReviewModels(connection: Connection) {
  const specification = new Schema<Specification>({
    label: { type: String, required: true, maxlength: 40 },
    value: { type: String, required: true, maxlength: 200 },
  }, { _id: false });

  const product = new Schema<ProductDocument>({
    _id: { type: String, required: true },
    title: { type: String, required: true, maxlength: 160 },
    sourceVersion: { type: Number, required: true, min: 0 },
    specifications: {
      type: [specification],
      default: [],
      validate: (items: Specification[]) => items.length <= 20,
    },
    reviewCount: { type: Number, required: true, min: 0, default: 0 },
    ratingTotal: { type: Number, required: true, min: 0, default: 0 },
  }, { versionKey: false, collection: 'lab_products' });

  const review = new Schema<ReviewDocument>({
    _id: { type: String, required: true },
    productId: { type: String, required: true },
    authorId: { type: String, required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: Number.isInteger,
    },
    content: { type: String, required: true, maxlength: 2_000 },
    createdAt: { type: Date, required: true },
  }, { versionKey: false, collection: 'lab_reviews' });
  review.index({ productId: 1, authorId: 1 }, { unique: true });
  review.index({ productId: 1, createdAt: -1, _id: -1 });

  return {
    products: connection.model<ProductDocument>('LabProduct', product),
    reviews: connection.model<ReviewDocument>('LabReview', review),
  };
}
```

`versionKey: false` does not declare concurrency control unnecessary. We handle the order of description copies with `sourceVersion`, and new reviews and aggregates with an explicit transaction. We do not assign the meaning of an order version or a source product version to Mongoose's general document version key. Naming what each kind of version protects separately lets the operator distinguish an outdated screen from a storage conflict.

The average rating is calculated as `ratingTotal / reviewCount` at read time. Rounding and storing the average each time, then averaging it again, accumulates error. The rating total here is not money; it is a sum of integers from 1 to 5. When the review count is 0, use `null` rather than the number 0 for the average so the screen can express "none yet." Do not introduce the different meaning of a zero-star rating.

## The application owns the connection and models

Fluo has no Mongoose registration API that discovers models automatically from a connection string alone. The application creates an actual connection, compiles its models, and then passes it to `MongooseModule.forRoot(...)` or `forRootAsync(...)`. The complete file `src/catalog/review-lab/review-lab.module.ts` below creates a module on each factory call and opens a new connection during container initialization. Pass a lab URI validated at the existing configuration boundary as the argument for the environment value.

```ts
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';
import { registerReviewModels } from './models.js';
import { ReviewCatalog } from './review-catalog.js';

export function createReviewLabModule(uri: string) {
  const databaseModule = MongooseModule.forRootAsync({
    useFactory: async () => {
      const connection = mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 3_000,
      });
      try {
        await connection.asPromise();
        const models = registerReviewModels(connection);
        await Promise.all([models.products.init(), models.reviews.init()]);
        return {
          connection,
          strictTransactions: true,
          dispose: async () => { await connection.close(); },
        };
      } catch (error) {
        await connection.close();
        throw error;
      }
    },
  });

  @Module({
    imports: [databaseModule],
    providers: [ReviewCatalog],
    exports: [ReviewCatalog],
  })
  class ReviewLabModule {}
  return ReviewLabModule;
}
```

Waiting for `init()` prevents this experiment from sending duplicate requests before the unique index has been created. It is not a recommendation to perform index changes on large production collections at every application startup. In production, manage the duration and load of index changes through a separate deployment procedure. If model registration or index creation fails during asynchronous initialization, close the connection even though it has not yet been returned to Fluo. After the return, the supplied `dispose` handles normal shutdown.

For another feature to inject `ReviewCatalog`, that feature's module must import this module. Listing modules side by side in the root `src/app.ts` does not automatically give siblings visibility of one another's tokens. You can wire the existing `CatalogModule`'s product query service to call this comparison lab, but the lab does not require making the existing Prisma module's exports global.

## The boundary that saves reviews and aggregates together

The complete file `src/catalog/review-lab/review-catalog.ts` below provides initial loading of product copies, description refreshes, review creation, and queries. `authorId` is an internal input taken from the existing principal by an authenticated application service. This code is not a public HTTP controller and does not demonstrate passing an entire request body through unchanged.

```ts
import { Inject } from '@fluojs/core';
import {
  MongooseConnection,
  type MongooseModelFacade,
} from '@fluojs/mongoose';
import type { ProductDocument, ReviewDocument, Specification } from './models.js';

export type ProductSnapshot = {
  id: string;
  title: string;
  version: number;
  specifications: Specification[];
};

type ProductModel = MongooseModelFacade<
  Promise<readonly ProductDocument[]>,
  unknown,
  PromiseLike<ProductDocument | null>,
  unknown,
  Promise<{ matchedCount: number }>
>;
type ReviewModel = MongooseModelFacade<
  Promise<readonly ReviewDocument[]>,
  PromiseLike<ReviewDocument[]>
>;

export class ReviewAlreadyExists extends Error {}
export class ProductProjectionMissing extends Error {}

function assertSnapshot(input: ProductSnapshot): void {
  if (
    input.id.trim().length === 0 ||
    input.title.trim().length === 0 ||
    input.title.length > 160 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0 ||
    input.specifications.length > 20 ||
    input.specifications.some((item) =>
      item.label.trim().length === 0 || item.label.length > 40 ||
      item.value.trim().length === 0 || item.value.length > 200)
  ) {
    throw new RangeError('Invalid product snapshot.');
  }
}

@Inject(MongooseConnection)
export class ReviewCatalog {
  constructor(private readonly conn: MongooseConnection) {}

  async importProduct(input: ProductSnapshot): Promise<void> {
    assertSnapshot(input);
    await this.conn.model<ProductModel>('LabProduct').create([{
      _id: input.id,
      title: input.title,
      sourceVersion: input.version,
      specifications: input.specifications,
      reviewCount: 0,
      ratingTotal: 0,
    }]);
  }

  async refreshProduct(input: ProductSnapshot): Promise<boolean> {
    assertSnapshot(input);
    const result = await this.conn.model<ProductModel>('LabProduct').bulkWrite([{
      updateOne: {
        filter: { _id: input.id, sourceVersion: { $lt: input.version } },
        update: { $set: {
          title: input.title,
          sourceVersion: input.version,
          specifications: input.specifications,
        } },
      },
    }]);
    return result.matchedCount === 1;
  }

  async addReview(input: {
    productId: string;
    authorId: string;
    rating: number;
    content: string;
  }): Promise<{ id: string }> {
    const content = input.content.trim();
    if (
      input.productId.trim().length === 0 ||
      input.authorId.trim().length === 0 ||
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5 ||
      content.length === 0 ||
      content.length > 2_000
    ) {
      throw new RangeError('Invalid review.');
    }
    const id = JSON.stringify([input.productId, input.authorId]);
    const createdAt = new Date();
    try {
      return await this.conn.transaction(async () => {
        await this.conn.model<ReviewModel>('LabReview').create([{
          _id: id,
          productId: input.productId,
          authorId: input.authorId,
          rating: input.rating,
          content,
          createdAt,
        }]);
        const result = await this.conn.model<ProductModel>('LabProduct').bulkWrite([{
          updateOne: {
            filter: { _id: input.productId },
            update: { $inc: { reviewCount: 1, ratingTotal: input.rating } },
          },
        }]);
        if (result.matchedCount !== 1) {
          throw new ProductProjectionMissing('Product projection is missing.');
        }
        return { id };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null &&
          'code' in error && error.code === 11000) {
        throw new ReviewAlreadyExists('A review already exists for this product.');
      }
      throw error;
    }
  }

  async product(id: string) {
    const product = await this.conn.model<ProductModel>('LabProduct').findOne(
      { _id: id }, null, { lean: true },
    );
    if (!product) return null;
    return {
      ...product,
      averageRating: product.reviewCount === 0
        ? null
        : product.ratingTotal / product.reviewCount,
    };
  }

  async recentReviews(productId: string) {
    type PublicReview = Pick<ReviewDocument, 'rating' | 'content' | 'createdAt'>;
    type PublicReviewModel = MongooseModelFacade<unknown, PromiseLike<PublicReview[]>>;
    const rows = await this.conn.model<PublicReviewModel>('LabReview').find(
      { productId },
      { _id: 0, rating: 1, content: 1, createdAt: 1 },
      { lean: true, sort: { createdAt: -1, _id: -1 }, limit: 20 },
    );
    return rows.map((row) => ({
      rating: row.rating,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
```

Here, `MongooseModelFacade` does not generate or validate application schemas. It is the application's declaration of the result shape of a dynamic model returned by Fluo. `recentReviews()` aligns the query projection with the `PublicReview` type and returns only the three public fields. It also converts dates into strings for JSON. We omit `_id` from the list because it contains a user ID. The ID returned by `addReview()` is an internal processing result; do not put it directly in a public HTTP response.

The review key does not simply use `productId + ':' + authorId` because that separator could occur in an input. JSON array encoding preserves the boundary between the two strings. This is an internal key for reproducing this lab's "one per user" rule. A production design that prioritizes data minimization can instead use a separate opaque review ID and only the `(productId, authorId)` unique index. Either way, the database uniqueness constraint is what ultimately prevents duplicates.

A check for an existing review before insertion is not enough to prevent duplicates: two requests can both read that none exists. If insertion violates a unique constraint, translate the failure to `ReviewAlreadyExists` outside the transaction. Swallowing the exception inside the transaction and then incrementing the aggregate creates a bug where one review is counted twice. At the real HTTP boundary, map this domain error to the project's explicit conflict response. A general `Error` class does not automatically become a 409.

Because the MongoDB driver or Mongoose may invoke a transaction callback again in some environments, the callback contains only database operations. It sends no emails, makes no payment requests, and increments no process metrics. We also determine `createdAt` and the key outside the callback to preserve the meaning of the same attempt. Falling back to direct execution on a connection without transaction support would break this design, which is why we use `strictTransactions: true`.

If a review-summary cache is added, register deletion with `afterCommit(callback: () => void | Promise<void>): void` on the same `MongooseConnection` after the review and aggregate writes succeed, rather than performing deletion inside the callback. Registration records an in-memory intent for later execution; it does not perform the external work now. Nor does it mean the database-only implementation above already includes a cache or mail delivery system. Boundary options are the final argument in `transaction(fn, boundary?)`, `requestTransaction(fn, signal?, boundary?)`, and `@Transaction(accessor?, boundary?)`. `{ requireAfterCommit: true }` rejects a lack of native commit observation with `AfterCommitCapabilityError` before invoking the callback. The existing fail-open default remains, but registration on unsupported boundaries, outside a boundary, or in a closed scope is rejected.

When a transaction delegated to Mongoose retries its callback, **each attempt gets a separate queue**. Hooks from discarded attempts never run; only the final successful attempt's queue drains after commit. A commit-only retry does not rerun the callback or register hooks again. Nested boundaries in the same attempt share its queue. Rollback and failed commit do not run it, and a caught nested exception without a savepoint follows the final outer outcome. Do not observe callback reinvocation and commit retries as the same kind of "running twice."

The user callback scope closes before native commit begins. Hooks are awaited one at a time in FIFO order after successful commit and settlement of session cleanup (`endSession`), outside the ended ALS context. New reads do not attach the old session, and a transaction opened by a hook uses a fresh queue. The first failure does not skip the remaining hooks. If session cleanup succeeds but hooks fail, `AfterCommitError`, a subclass of `AggregateError`, retains `readonly committed = true`, FIFO `results: readonly PromiseSettledResult<void>[]` for every success and failure, and `errors` for every failure. Hook errors are not reasons to retry the native transaction or run rollback or abort. Shutdown waits for running hooks and does not accept late registration into the closed queue.

On the manual session path, an `endSession()` failure after confirmed native commit for an owning boundary that registered hooks or opted into `requireAfterCommit: true` (including a nested `requestTransaction` requirement) still allows every hook to be attempted outside the ended ALS context. This is reported as the separate `AfterCommitCleanupError`. It extends `AggregateError` directly, not `AfterCommitError`, so `instanceof AfterCommitError` alone does not catch it; handle it in a separate branch. `committed` is `true`, `cause` is the cleanup failure, and `results` contains only hook outcomes in FIFO order. The first entry in `errors` is the cleanup failure, followed by failed hook reasons in registration order. Do not retry the already-committed review writes or run rollback or abort in this case either. Legacy boundaries with no hooks and no `requireAfterCommit` requirement preserve the original cleanup error identity and no-hook request cancellation contract, including the original `AbortError`.

The related `AfterCommitCallback` and `TransactionBoundaryOptions` types and all three errors are root exports of `@fluojs/mongoose`. The [package README](../../packages/mongoose/README.md) owns the API, and [Transaction Context](../../docs/architecture/transactions.md) owns shared semantics. Transactions opened directly by raw connections and other wrappers or connections are not observed. Execution is limited to a successful in-process owning boundary; it does not atomically combine MongoDB with PostgreSQL or Redis, or provide an outbox, crash recovery, or network exactly-once delivery. Design cache-deletion retries and durable delivery policies separately.

## Calls that receive a session automatically, and calls that do not

The brackets in `create([document])` are not a style choice. Fluo merges session options into Mongoose's array overload. Passing multiple documents as positional arguments, as in `create(documentA, documentB)`, does not receive the same automatic injection. Also, while `bulkWrite`, `find`, `findOne`, and `aggregate` are supported, not every model or document method is automatically wrapped.

Call `this.conn.model(...)` inside the transaction to obtain a facade reflecting its active session. Do not change this into caching a model in a field outside the transaction and calling it later. `current()` is an escape hatch returning the root connection, not a method that also selects a session for you. Native operations through a root model require explicit session attachment and management of its type and lifetime.

To modify an existing document, you can use Fluo's `saveDocument(document, options?)` inside an active boundary. This helper attaches the current session and rejects calls outside a boundary, `{ session: null }`, and attempts to escape to a different session. Calling `document.save()` directly, by contrast, retains Mongoose's default behavior. This chapter does not introduce review editing or deletion, so the current implementation does not need this helper. If editing is added later, put the aggregate adjustment by the rating difference and the document save in the same boundary.

The following is the **complete source experiment file** `src/catalog/review-lab/session-contract.test.ts`, which checks only the session propagation boundary without a database. It does not simulate real MongoDB rollback; it checks only how Fluo merges create options. Vitest uses the existing project's standard decorator configuration.

```ts
import { MongooseConnection, type MongooseModelFacade } from '@fluojs/mongoose';
import { expect, it } from 'vitest';

it('keeps review options and attaches only the ambient session', async () => {
  const calls: unknown[][] = [];
  const session = {
    startTransaction() {},
    commitTransaction() {},
    abortTransaction() {},
    endSession() {},
  };
  const model = {
    async create(...args: unknown[]) {
      calls.push(args);
      return [];
    },
  };
  const raw = {
    async startSession() { return session; },
    model() { return model; },
  };
  const conn = new MongooseConnection(raw, undefined, { strictTransactions: true });
  type Model = MongooseModelFacade<Promise<unknown[]>>;
  try {
    await conn.transaction(async () => {
      await conn.model<Model>('LabReview').create(
        [{ content: 'Fits well.' }],
        { ordered: true },
      );
    });
    expect(calls).toEqual([[
      [{ content: 'Fits well.' }],
      { ordered: true, session },
    ]]);
    await expect(conn.transaction(async () => {
      await conn.model<Model>('LabReview').create(
        [{ content: 'Must fail.' }],
        { session: null },
      );
    })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(conn.currentSession()).toBeUndefined();
  } finally {
    await conn.onApplicationShutdown();
  }
});
```

If `ordered: true` disappears in this experiment, the option preservation contract is broken. If an explicit `session: null` call reaches the raw model, escape from the transaction has been allowed. If the final `currentSession()` is not empty, a session could leak into another request. This makes the boundary being proved clearer than a test that checks only the length of a successful array. This manuscript presents reproducible code and expected results, not results from running the experiment.

## Verify copy lag separately from real atomicity

For the real database experiment, initialize the module in a new lab database, then use `importProduct()` to insert ID `shirt-logo`, version 3, and one specification entry. When the first reader submits a rating of 5, the expected result is one review, `reviewCount=1`, `ratingTotal=5`, and an average of 5. The same reader's second review must be rejected, with all three values unchanged. If another reader's rating of 3 succeeds, the count should be 2, the total 8, and the average 4.

Create a partial failure by writing a review for a product ID that does not exist. After the review insertion, the product update's `matchedCount` is 0 and an exception is thrown. After the call finishes, use an **independent connection outside the transaction** to verify that the review does not exist. This observation is necessary to catch an orphaned document where only the review remains. An in-memory fake throwing an exception is not evidence of real database rollback.

For the concurrent duplicate experiment, start two calls with the same `(productId, authorId)` and wait for both to finish. There must be one success and one review in the final state. If a retryable server error is exposed, record it separately from a duplicate error and check the actual driver retry policy. The application must not retry every exception indefinitely or unconditionally turn both responses into successes.

For the description refresh experiment, apply a version 5 copy before delivering version 4. `refreshProduct()` should return `false`, and the title must remain the version 5 value. Redelivery of the same version also changes nothing. This condition does not touch the review aggregate fields, so refreshing a description does not reset ratings to 0. It prevents the product bug that an incautious whole-document replacement can cause.

`false` does not distinguish a missing document from a stale event. The consumer checks existence with `product()` and, if absent, chooses a recovery procedure that fetches the current full snapshot from Catalog for an initial load. Calling `importProduct()` again for a document already loaded causes a unique-key conflict. This comparison lab explicitly separates initial bulk loading from subsequent refreshes; it does not claim to implement a production automatic consumer or a durable Inbox.

There is no single local transaction spanning a PostgreSQL product change and a MongoDB copy change. Even the Outbox learned earlier leaves a period of lag. A display screen can therefore tolerate delayed descriptions, but payment price validation continues to use Catalog's authoritative source. More important than the choice of database is deciding which product behavior can accept that delay.

For shutdown, receive a callback-entry signal, start `onApplicationShutdown`, and verify that new transactions are rejected after shutdown begins. Cancellation of an existing request boundary and actual completion of its callback may not happen at the same moment. Fluo ends the session and disposes the connection after the started callback finishes cleanup. Rather than sleeping for a fixed duration and asserting that the connection closed, record the order of the callback-completion and dispose-call signals.

## What you gain even if you do not adopt the document model

Embedding a bounded list of specifications simplifies display reads. But writing review aggregates to the same product document on every review makes a popular product a contention point. As the review count grows, one option is to guarantee only the full review write synchronously and move aggregation to an asynchronous projection. The average can then lag briefly, and the recalculation and deduplication contracts need redesign. The current transaction example cannot simply be called an "infinitely scalable review system."

Operating only PostgreSQL leaves one set of backups, failure response procedures, account permissions, and observability tools. Adding MongoDB may make document access easier, but it requires distinguishing sources from copies across two stores and maintaining a reload path. Adding a new operational system for a few product descriptions can cost more than it brings. The experiment is still a success if the team finishes the comparison lab and decides to keep PostgreSQL.

The shop now has a vocabulary for explaining what is stored atomically and what is reflected later. In the next sale, review copies or fulfillment work may fall behind even while the API returns normal responses. The next chapter moves beyond a single "the server is alive" signal to observe order transitions, processing time, waiting work, and readiness to accept traffic as distinct signals.

## Evidence and further source reading

- [Mongoose connection ownership, session, and save contracts](../../packages/mongoose/README.md), [public exports](../../packages/mongoose/src/index.ts), [facade and connection option types](../../packages/mongoose/src/types.ts)
- [Session merging for supported operations and shutdown implementation](../../packages/mongoose/src/connection.ts), [transaction target selection](../../packages/mongoose/src/transaction.ts), [asynchronous module registration](../../packages/mongoose/src/module.ts)
- [Service boundary experiments](../../packages/mongoose/src/vertical-slice.test.ts), [concurrent session isolation tests](../../packages/mongoose/src/session-isolation.test.ts), [module, option, and disposal regression tests](../../packages/mongoose/src/module.test.ts)
- [Per-attempt after-commit regression verification target](../../packages/mongoose/src/after-commit.test.ts), [shared behavioral matrix verification target](../../tooling/governance/after-commit-contract.test.ts): the session propagation experiment above alone does not verify these behaviors or actual MongoDB commits.

[Previous](./ch25-drizzle-lab.md) | [Table of Contents](./toc.md) | [Next](./ch27-sale-observability.md)
