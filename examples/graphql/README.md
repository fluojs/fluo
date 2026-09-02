# GraphQL example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

A runnable `@fluojs/graphql` application that keeps module registration, resolver discovery, operation-scoped DataLoader use, and one SSE subscription path in the same small application.

## what this example demonstrates

- `GraphqlModule.forRoot({ resolvers })` registration with every resolver also registered as a module provider
- A root `books` query and a `Book.author` field resolver discovered from the compiled module graph
- `createDataLoader(...)` scoped to one GraphQL operation so repeated author lookups share a loader without crossing request boundaries
- A default SSE `bookPublished` subscription that is active before the `publishBook` mutation emits its update

## how to run

From the repository root:

```sh
pnpm install
pnpm --filter @fluojs/example-graphql typecheck
pnpm vitest run examples/graphql
```

The test starts the same `AppModule` as the executable entry point, performs a real GraphQL query, subscribes before triggering `publishBook`, and closes the application and the SSE stream.

To run the application manually:

```sh
pnpm --filter @fluojs/example-graphql start
```

In a second terminal, query `http://localhost:3000/graphql`:

```sh
curl -X POST http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ books { title author { name } } }"}'
```

## project structure

```text
examples/graphql/
├── src/
│   ├── app.ts       # Module registration, resolvers, DataLoader, SSE updates
│   ├── app.test.ts  # Startup, query, and subscription verification
│   └── main.ts      # Node runtime entry point
├── package.json
├── README.md
├── README.ko.md
└── tsconfig.json
```

## related docs

- `../README.md` — official examples catalog
- `../../packages/graphql/README.md` — `@fluojs/graphql` contracts and API
- `../../book/intermediate/ch18-graphql.md` — GraphQL learning path
- `../../docs/CONTEXT.md` — package-surface discoverability
