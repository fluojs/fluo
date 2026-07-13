# OpenAPI multiple documents example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Runnable fluo example for serving multiple OpenAPI documents from one application. It registers `OpenApiModule` twice with distinct JSON and Swagger UI paths so each API surface remains independently addressable.

## what this example demonstrates

- two `OpenApiModule.forRoot(...)` registrations in one root module
- distinct `documentPath` and `uiPath` values for public and admin documents
- request-level verification of both JSON documents and both Swagger UI pages
- adapter-first Fastify bootstrap following the current official example convention

## routes

- `GET /openapi/public.json` — Public API document
- `GET /docs/public` — Public API Swagger UI
- `GET /openapi/admin.json` — Admin API document
- `GET /docs/admin` — Admin API Swagger UI

## how to run

From the repository root:

```sh
pnpm install
pnpm --filter @fluojs/example-openapi-multiple-documents typecheck
pnpm vitest run examples/openapi-multiple-documents
```

The request-level test boots the same `AppModule` used by the adapter-first `src/main.ts` entry point.

## project structure

```text
examples/openapi-multiple-documents/
├── src/
│   ├── app.ts
│   ├── app.test.ts
│   └── main.ts
├── package.json
├── README.md
├── README.ko.md
└── tsconfig.json
```

## related docs

- `../README.md` — official examples index
- `../../packages/openapi/README.md` — `@fluojs/openapi` contract and options
- `../../docs/architecture/openapi.md` — OpenAPI runtime architecture and collision behavior
- `../../book/beginner/ch10-openapi.md` — beginner OpenAPI walkthrough
