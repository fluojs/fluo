# Editorial standards for the three-volume series

## Confirmed direction

Korean is the source language of this book. Initial authoring completes and reviews all 72 Korean chapters before English translation. Corrections to an existing Book review, finalize, and freeze the whole affected Korean set, including dependent chapters, before English translation. Do not draft the English manuscript alongside unfinished Korean writing. The fixed table of contents and file identifiers are in [series.json](./series.json). Volume 1 has 24 chapters, volume 2 has 28, and volume 3 has 20.

The Book is the primary learning path. The site's short FluoBlog exercise is an executable companion for the initial HTTP/DI lessons. Place the new manuscripts in book/01-fluoblog, book/02-fluoshop, and book/03-internals. Preserve the existing beginner/intermediate/advanced files as stable links and contract evidence for the previous edition. The new text does not inherit that edition's project-state or chapter-snapshot claims.

The normative source for framework facts is the Docs layer defined by the [Docs authority policy](../docs/contracts/documentation-authority.md), with package READMEs as its delegated package API owners. The Book explains those same contracts for people through product requirements, design reasons, execution, and failure scenarios. Follow Docs contract establishment -> evidence verification -> Korean Book application -> English alignment -> handoff. Resolve contract, implementation, and test conflicts in the owning Docs first, distinguishing documentation errors from implementation regressions without silently reducing existing guarantees to match implementation.

## Narrative and product continuity

The operator in volume 1 creates FluoBlog to share development experience. Writing, publication, reader accounts, subscriptions, and operations become necessary in turn. At the end of volume 1, readers ask for logo T-shirts and stickers.

Volume 2 starts with the same application, user IDs, authentication, configuration, deployment, and observability foundation from volume 1. Do not rebuild accounts and content. Add catalog, inventory, cart, orders, payments, fulfillment, and notifications modules when needed. Develop a modular monolith first, and extract only fulfillment into another process in chapter 23. The comparison labs in chapters 24-26 do not add every broker and ORM to the main application simultaneously.

Volume 3 traces the same post and order requests through real Fluo source. Connect questions, small executable experiments, implementation evidence, failure conditions, and extension techniques instead of listing packages or stale line numbers.

## Shared names and data contracts

This section's product models, KRW choice, post/order states, and app addresses are application-owned policies. Do not describe them as framework guarantees automatically provided by Fluo. Framework defaults, order, failures, and resource ownership follow the owning Docs contracts; distinguish intentionally failing intermediate implementations and comparison experiments from the final recommended implementation.

- The application directory is the CLI-generated fluo-blog, with source paths src/app.ts, src/main.ts, and `src/<feature>/...`. Do not confuse existing example-repository paths with files the reader creates.
- Feature modules are AccountsModule, PostsModule, CatalogModule, InventoryModule, OrdersModule, PaymentsModule, and FulfillmentModule. An interface name alone does not enable DI. Show class-level @Inject, actual tokens, and imports/providers/exports registration.
- Add post fields id, authorId, title, content, slug, status, version, and publishedAt when they become necessary. Post.id is a positive integer (Prisma Int); authorId is a string user ID. A new draft starts at version 1 and reaches 2 after its first edit or publication. The original published seed also retains version=2. Status is draft or published, and the main publication transition is draft -> published. Only drafts may be edited; published content stays immutable. Revision support is a separate product change, not something silently permitted in the authorization chapter. The minimal first HTTP seed is id=1, title=Hello, Fluo!, content=My first post.
- Reuse volume 1's user identifier and JWT subject in volume 2. Extend the existing account with customer information rather than creating another account table. Do not expose passwords or raw tokens in responses or logs.
- Orders contain id, customerId, status, currency, totalMinor, and version. Use pending_payment, paid, fulfilling, shipped, cancelled, refund_pending, and refunded as the state names. Inventory reservations have a lifecycle separate from order status. Do not allow arbitrary state transitions.
- The main currency is KRW, with amounts represented as integer minor units. When TypeScript uses bigint internally, convert it to a decimal string at JSON boundaries. Check DB integer bounds, currency agreement, and valid quantities at the boundary. Do not calculate payment amounts with floats.
- An order item's SKU, unit price, quantity, and discount are snapshots taken at ordering time. Later product changes do not change past orders. Do not treat client-supplied prices or customerId as authoritative.
- Use HTTP paths /posts, /posts/:id, /auth/..., /products, /cart, /orders, /orders/:id, and /payments/webhooks. Design missing resources as 404, validation failures as 400, forbidden operations as 403, unauthenticated requests as 401, and conflicts as 409, while checking the actual framework exception mapping.
- The main database path is PostgreSQL + Prisma. Drizzle in volume 2 chapter 25 and Mongoose in chapter 26 are separate comparison labs. Application-owned models and tables are examples defined by the book, not features generated by a Fluo package.
- The asynchronous path proceeds through a Redis-backed queue, an in-process event-bus, and a RabbitMQ service boundary when needed. Check each package's real support contract instead of generalizing ACK, durability, or retry policies.

## Implementation boundaries to preserve across chapters

The single database registration in volume 1 chapter 10 is BlogDatabaseModule in src/database/blog-database.module.ts. PrismaModule.forRootAsync injects AppSettings, creates a client per container, and shares it with global: true. Reuse the same object in volume 2. Do not assume a nonexistent global prisma variable or create another DatabaseModule and forRoot alongside it. Passing the same raw client does not merge the transaction contexts of different PrismaService instances.

Post drafts allow empty titles, content, and slugs. The UTF-16 length limits are 120 for title, 50,000 for content, and 80 for slug, with additional completeness checks on publication. Slug uniqueness applies to published posts. The authentication chapter must not bypass the domain with different length units or looser limits. Do not protect a new PATCH while leaving the earlier anonymous POST, PUT, and publication routes available.

The SKU model in volume 2 is ProductVariant, introduced in chapter 3. Preserve priceMinor, active, and the parent Product publication condition in pricing and cart code. If a discount field is needed, explicitly extend the existing model and map it to PriceRow. Do not require sales data to be populated again in a separate CatalogSku ledger.

Inventory is based on Stock.available and Reservation with the composite key (orderId, sku). Decrease saleable quantity when reserving. On payment confirmation, mark the reservation consumed without decrementing quantity again. Pre-payment cancellation returns quantity once, only for reservations transitioned to released. Post-payment refunds use the same inventory ledger with a separate durable compensation record. Do not insert an unexplained Inventory.onHand - reserved accounting model.

Unlike post versions, order versions begin at 0. OrderTransitionsService.apply stores status, version, and OrderTransition in the same transaction. OrderInventoryService.confirmPayment combines the transition with reservation checks. Preserve these guarantees in webhooks, reconciliation, refunds, and Outbox handling. Outbox does not replace the audit history of every state transition.

The real payment ledger is PaymentLedger.prepare/record in src/payments/payment-ledger.ts. Provide the coordinator that uses the saved attempt ID and amount to charge outside the transaction. Attach the event chapter to this actual boundary; do not treat an unimplemented confirm-payment.service.ts as existing code.

## What makes a chapter complete

Chapter titles follow the fixed table of contents. The body must be a complete manuscript readers can learn from, not an outline or a writing plan. Each chapter includes:

1. A concrete product requirement and the state inherited from the previous chapter.
2. A specific situation in which the existing implementation fails, and why.
3. A small initial implementation, followed by a necessary pattern when the requirement justifies it.
4. Code using real Fluo APIs and the file/module boundary where it belongs.
5. Topic-specific failures such as contention, duplication, partial failure, and shutdown, not only a happy path.
6. Meaningful tests or executable experiments and expected results. Do not claim that an unrun command passed.
7. When not to use the pattern, the cost of alternatives, and the state passed to the next chapter.
8. Clickable evidence links to the owning Docs contracts and delegated package READMEs, source, and tests.

Avoid padding and repeated sentences. In particular, do not reduce a complex consistency chapter to a short checklist or a few design tips. Develop the explanation, the reasons behind the code, and the failure scenarios in connected paragraphs. Do not delegate a chapter's essential steps to external documents. Long code blocks without explanation are not a completed manuscript either.

## Honesty about code and verification

Distinguish complete files, application fragments, and explanatory pseudocode. Complete files include required imports and types. Fragments define the classes, schema, tokens, and locations they require. Do not replace essential behavior with TODO, omissions, future implementation promises, or a single comment. Do not recommend unnecessary generic repositories, CQRS for every operation, or unjustified microservice extraction as good patterns.

The fixed table of contents defines the product-development scope, but it does not claim the repository already contains completed applications for all 72 chapters. Existing executable examples/fluo-blog checkpoints support the initial HTTP/DI/validation path. Database, email, broker, and payment-provider experiments state their required environment and reproduction steps, distinguishing actual integration verification from unit and contract checks.

Outbox/Inbox, durable Saga state, webhook signature verification, idempotency storage, password hashing, and payment/file-storage adapters are application-owned implementations. Do not claim that package registration alone creates exactly-once behavior, restart recovery, or payment consistency. Code involving money, external systems, or time states who owns failures and retries.

The supported Node.js range is >=24.0.0 <27; the book uses Node24 and pnpm10. Volume 1 chapter 1 sets TypeScript lib to ES2024, DOM, and ESNext.Decorators, and later configuration changes preserve it. The CLI's ES2022 target alone does not expose Promise.withResolvers types. Use standard decorators without depending on experimentalDecorators/emitDecoratorMetadata. Do not confuse a TC39 stage with native runtime support. When using current helpers such as runFastifyApplication, read their actual options and lifecycle contracts.

## Sources and links

Find owner pairs for shared contracts in the [Docs hub ownership table](../docs/README.md#source-ownership). Compare chapter claims with the owning Docs scope, prerequisites, public imports, inputs, defaults, outputs, order, failures, ownership, and limitations, keeping source and tests as additional evidence. Record chapters affected by a Docs change, or explain in the handoff why no Book edit is needed when meaning is unchanged. Owner links do not replace essential chapter explanations or execution steps.

Check each chapter's API claims against the owning `packages/<name>/README.md` and current public src/ exports. Links from a chapter to repository-root documents use ../../packages/... or ../../docs/.... Internal series links use the fixed slugs. Every chapter except the last includes previous, next, and volume-contents links. Volume boundaries connect to the first chapter of the next volume.

Place an identifier such as `<!-- book:volume=01-fluoblog;chapter=01 -->` near the top of each chapter. Package assignments live in series.json. Preserve code and commands exactly in English translation. Do not pin natural-language explanations in tests. Automate only structure, links, code-block equality, and explicit executable examples.

## Translation after Korean approval

Review and freeze all three Korean volumes for initial authoring, or the whole affected Korean set for corrections, for technical and narrative continuity first. Then create English .md files from that approved source, without omitting chapter/section order, examples, commands, results, defaults, limitations, or failure conditions. Translation is neither an abridgement nor a new manuscript. Keep comments inside code blocks identical initially so executable examples do not diverge. Use idempotency, reconciliation, compensation, visibility, and disposal consistently for their Korean counterparts.

Temporary locale incompleteness is allowed during Korean authoring, but each mergeable increment includes finalized Korean text and its English companions. Group dependent chapters into jointly verifiable increments without mixing in untranslated drafts. Use `pnpm book:check:ko` during authoring and `pnpm book:check` for bilingual increments. Passing existing structure, link, and code checks does not automatically prove translation meaning or Docs alignment across all 72 chapters. Record actual check commands, results, and unverified scope in a receipt.
