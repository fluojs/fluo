# Volume 1 - FluoBlog: Building Your First Operable Service

[Series introduction](../README.md) | [Full contents](./toc.md)

The product in this volume is a small blog started to share development experience. Returning a single post is enough at first. Editing and publishing introduce state and permissions; more readers bring subscriptions and caching. After deployment, we need to explain slow requests and failures. This volume develops the code in the order those needs arise.

## What you will learn

The goal is to learn where responsibilities belong rather than memorize package options. Controllers own request boundaries, services own operations, and domain models own rules. We do not create every layer and interface in the first chapter. We observe the failures of a small implementation and change its structure only as much as necessary.

Tests are not an appendix added after completion. Chapter 4 distinguishes unit, module, and request tests. We then use the same habits to check input validation, publication transactions, permissions, queues, and shutdown. We examine not only successful responses but whether failed requests leave data unchanged.

## Starting point and environment

You should know TypeScript functions, classes, Promises, and basic HTTP concepts. No Fluo experience is required. The main path uses Node.js 24, pnpm 10, Fastify, PostgreSQL, and Prisma. Redis, queues, and email are introduced when a feature needs them. You do not have to install every piece of infrastructure on the first day.

The reader's application is the CLI-generated fluo-blog. We distinguish application file paths from implementation-evidence paths in the Fluo repository. Each example states whether it is a complete file or a fragment to apply to existing code. Current package READMEs and behavioral contracts govern actual package behavior.

The [short HTTP exercise](../../apps/docs/content/docs/tutorial/index.mdx) and [executable initial checkpoints](../../examples/fluo-blog/README.md) can help you compare the first HTTP, DI, and validation path. They do not supply a completed application containing this volume's database, authentication, or subscription features.

## How the volume progresses

The first four chapters run and test one feature. We then separate state, DTOs, response models, and error contracts before persisting data. Once users and permissions exist, we add public pages, files, and subscriptions. Finally, we connect scheduled work, observability, readiness, and shutdown to review the first release.

Read each chapter's failure scenarios and decision criteria together. A development-only memory implementation, a test double, and a real external system provide different evidence. For experiments requiring an external service, check the environment and reproduction steps and run them yourself. A printed command is not proof of operational safety.

## What carries into the next volume

At the end of this volume, we retain accounts and content modules, user identifiers and authentication policy, configuration, deployment, and observability. The next volume does not discard them to create an unrelated store. Readers who like the blog ask for T-shirts and stickers, and commerce grows inside the same service.

Start with [chapter 1: FluoBlog's first executable path](./ch01-first-app.md).
