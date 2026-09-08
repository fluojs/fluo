# fluo: A three-volume guide to backend design through product development

[한국어](./README.ko.md) · [English](./README.md)

A service begins as a personal blog, attracts readers, and grows into a merchandise shop. Along the way, we turn features into clear, testable code, preserve consistency around money and inventory, and finally explore the Fluo internals that execute that code.

The Book itself is the primary learning path. Instead of reading package API lists in sequence, we learn good code patterns and backend design by solving problems that arise in the product. We introduce a pattern because it reduces a concrete failure, not to accumulate pattern names.

## The journey through three volumes

| Volume | Product and question | Start here |
| --- | --- | --- |
| Volume 1, 24 chapters | FluoBlog: how to turn features into clear, testable, operable code | [Introduction](./01-fluoblog/README.md) · [Contents](./01-fluoblog/toc.md) |
| Volume 2, 28 chapters | FluoShop: how to add merchandise sales to the same blog while preserving consistency across money, inventory, and external systems | [Introduction](./02-fluoshop/README.md) · [Contents](./02-fluoshop/toc.md) |
| Volume 3, 20 chapters | Inside Fluo: how to explain the two products through source and verify and extend the framework | [Introduction](./03-internals/README.md) · [Contents](./03-internals/toc.md) |

If you are starting out, go to [volume 1 chapter 1](./01-fluoblog/ch01-first-app.md). If you already use Fluo and need a particular pattern, choose it from the volume's contents. Volume 2 preserves the accounts, content, configuration, and operational foundation from volume 1. Volume 3 experiments use the same post and order requests, connecting earlier design choices to their internal execution.

## How we learn

Each chapter starts with a concrete product requirement and a limitation in the current code. We build a small implementation, observe the conditions under which it fails, and introduce a necessary pattern. Code and tests expose input/output boundaries, transactions, idempotency, lifecycle, and recovery ownership.

We do not check only successful responses. We examine whether invalid input leaves data unchanged, what happens when the same webhook arrives twice, and how to reconcile an external operation that succeeded before its response was lost. We also explain when another choice is simpler. Wrapping every service in a repository or converting every operation to CQRS is not the objective.

## Broad package coverage without putting everything into one app

The main chapters and comparison labs cover the current 43 public packages. We introduce foundations and HTTP, authentication, persistence, notifications, messaging, operations, React, and runtime adapters as the product requires them. The [fixed contents data](./series.json) records package assignments by chapter. Consult the [package surface](../docs/reference/package-surface.md) and owning README for actual support boundaries.

The main path consistently uses Node.js 24, pnpm 10, Fastify, PostgreSQL, and Prisma. The transport, Drizzle, and Mongoose chapters in volume 2 and the runtime chapters in volume 3 compare different implementations of the same requirements. Learning multiple ORMs or brokers does not require installing all of them into the operational application at once.

## Manuscripts, executable examples, and contract documents

The new manuscripts live in book/01-fluoblog, book/02-fluoshop, and book/03-internals. They distinguish application files the reader writes, explanatory fragments, and implementation evidence in the repository. They do not assume the repository already supplies a completed application for every chapter. Experiments involving external databases, email, brokers, or payment providers describe their required environment and reproduction steps.

The [short FluoBlog HTTP exercise](../apps/docs/content/docs/tutorial/index.mdx) and [initial executable checkpoints](../examples/fluo-blog/README.md) are companions for the first routing, DI, and validation path. They neither replace the entire book nor implement its later database, authentication, and commerce features. The [official examples catalog](../examples/README.md) explains each example's verification scope.

Package APIs and lifecycle behavior are governed by the [behavioral contracts](../docs/contracts/behavioral-contract-policy.md) and owning READMEs. Application designs such as Outbox, durable Saga state, payment reconciliation, and file storage are not described as automatically supplied package features. Framework contracts and product policies are different responsibilities.

## The previous edition and stable links

The existing [Beginner](./beginner/toc.md), [Intermediate](./intermediate/toc.md), and [Advanced](./advanced/toc.md) files remain to preserve previous-edition links and contract evidence. Use the three new volume contents above for the current learning order and chapter numbers. Previous project-state labels are not executable checkpoints for this series.

## Language and verification

Korean is the authoring source; English translates the reviewed Korean manuscript. Chapter and section flow, code, commands, output, limitations, and failure conditions remain aligned across languages. The [editorial standards](./EDITORIAL.md) define shared names and the guarantees of the examples.

Run pnpm book:check:ko in the repository to check Korean manuscript structure and links, or pnpm book:check to check both languages and code equality. These checks do not establish educational completeness or successful integration with an external payment provider. Combine them with technical/narrative review and execution in the relevant environment.
