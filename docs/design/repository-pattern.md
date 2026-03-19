# repository pattern decision

This document records the repository abstraction decision for database integrations in Konekti.

## context

`@konekti/prisma` and `@konekti/drizzle` already provide transaction-aware database wrappers with async-local transaction propagation.

- Prisma integration exposes transaction-aware Prisma client usage via `$transaction(...)`
- Drizzle integration exposes transaction-aware Drizzle usage via `transaction(...)`

Because both adapters already ship strong typed query APIs, any extra repository abstraction must justify its cost.

## options considered

### option a: generic `BaseRepository<T, ID>`

Provide a shared generic base with operations such as:

- `find(...)`
- `findById(id)`
- `save(entity)`
- `delete(id)`

Pros:

- common shape across projects
- lower initial boilerplate

Cons:

- hard to model Prisma/Drizzle query capabilities without leaky abstraction
- weakens type precision for complex filters, includes, relation loading, and projections
- tends to force lowest-common-denominator CRUD even for domain-specific workflows

### option b: no base repository

Do not introduce framework-level repository base classes. Users write domain repositories directly on top of Prisma/Drizzle clients.

Pros:

- preserves native type safety and IDE support from Prisma/Drizzle
- avoids unnecessary abstraction layers and indirection
- keeps repository APIs domain-focused instead of generic CRUD contracts

Cons:

- more variability between projects
- slightly more upfront design effort per domain

### option c: thin transaction-aware repository contract

Provide only a minimal interface focused on transaction handle resolution/propagation, without generic CRUD methods.

Pros:

- standardizes transaction-awareness behavior
- avoids most CRUD abstraction drawbacks

Cons:

- still adds framework surface area with limited practical gain
- can duplicate existing transaction helpers in adapter packages

## decision

Recommend **Option B**: no framework-level base repository.

Reasoning:

- Prisma and Drizzle already provide excellent typed query APIs
- a generic base repository would either lose type safety or become a thin pass-through abstraction with little value
- domain-specific repositories remain clearer and better aligned with aggregate/business boundaries

## migration execution hooks

Two migration execution approaches were evaluated:

1. runtime hook execution (for example `onModuleInit`-driven migration checks)
2. external migration CLI execution in deploy/runtime pipeline

Recommendation: use **external migration CLI**.

- Prisma: `prisma migrate deploy`
- Drizzle: `drizzle-kit push` (or equivalent migration command)

Why:

- avoids startup-time schema mutation risk
- keeps migration responsibility explicit in deployment operations
- aligns with established operational best practices

Runtime hooks can remain an opt-in project-level strategy for exceptional environments, not a framework default.

## status

Documented decision only. No code changes are required by this decision record.
