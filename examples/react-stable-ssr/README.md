# react-stable-ssr example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Stable `@fluojs/react` SSR MVP example for the `0.1.0` package surface. It keeps routing and
request lifecycle ownership in `@fluojs/http` while using React for page-shaped streamed HTML.

## what this example demonstrates

- `@Router('/products')` and `@Path('/:sku')` as lexical React facades over HTTP controller and
  `GET` route metadata.
- DTO-bound path and search parameters with `@RequestDto(...)`, `@FromPath('sku')`, and
  `@FromQuery('preview')`.
- HTTP-owned route grammar: literal segments plus full-segment `:param` placeholders only.
- Guards, interceptors, module middleware, route headers, and entry headers running before the React
  server entry commits HTML.
- Web Streams SSR through `createReactServerEntry(...)` and lazy `react-dom/server` rendering.
- Explicit hydration asset options from the stable root: `bootstrapModules`, trusted
  `bootstrapScriptContent`, `nonce`, `identifierPrefix`, and a trusted `assetMap` snapshot.

## stable boundaries

This example intentionally does **not** model Next.js App Router, React Server Components, Server
Functions, TanStack route trees, Angular `Routes[]`, file routes, or a React-owned `routes: []`
table. The route is discovered through the fluo module/controller graph, URL matching stays in
`@fluojs/http`, and the React package only adds page-oriented naming plus SSR rendering helpers.

Additional phase boundaries remain outside this example:

- `@fluojs/react/vite` — current parsing of already-loaded Vite build manifests into deterministic
  hydration assets. It does not discover manifests from the filesystem.
- `@fluojs/react/client` — HTTP-first browser navigation and client hydration helpers.
- `@fluojs/react/experimental/rsc` — the unstable exact-version RSC manifest and HTTP Flight response
  prototype. It remains outside this stable SSR example and does not include Server Functions.

## run from the repo root

```sh
pnpm install
pnpm vitest run examples/react-stable-ssr
pnpm typecheck
```

## project structure

```txt
examples/react-stable-ssr/
├── src/
│   ├── app.ts       # AppModule imports ReactModule.forRoot(...)
│   ├── main.ts      # Optional Fastify startup for local manual runs
│   ├── pages.ts     # Router, DTO, guard, interceptor, middleware, and SSR entry
│   └── app.test.ts  # createTestApp request-pipeline SSR assertion
├── README.md
└── README.ko.md
```

## related docs

- `../../packages/react/README.md` — stable React SSR package contract
- `../../docs/reference/package-surface.md` — canonical package surface
- `../../docs/reference/package-chooser.md` — package selection by task
- `../../docs/contracts/behavioral-contract-policy.md` — behavior/docs/test alignment rules
