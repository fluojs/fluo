# react-vite-ssr example

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Minimal Vite-backed `@fluojs/react` application for the `0.2.0` example phase. It connects
HTTP-owned page routes, DTO-bound parameters, streamed React SSR, Vite manifest assets, and one
hydrated browser interaction without introducing a second routing model.

## what this example demonstrates

- `@Router('/products')` and `@Path('/:sku')` page routes discovered by the fluo HTTP module graph.
- Typed path and search input through `@RequestDto(...)`, `@FromPath('sku')`, and
  `@FromQuery('preview')`.
- A `Suspense` boundary whose fallback and resolved recommendation content are emitted by Web
  Streams SSR.
- A Vite client build that writes `dist/client/.vite/manifest.json`, then
  `@fluojs/react/vite` turns that loaded manifest into ordered CSS and hydration module assets.
- A server-rendered counter that becomes interactive through React DOM `hydrateRoot(...)`.
- A production build served by the Fastify adapter, including the generated Vite client assets.

## run from the repo root

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

Open `http://127.0.0.1:3000/products/sku-42?preview=true`, then activate `Count: 0`. The label
changes to `Count: 1` only after the Vite-generated client entry hydrates the server HTML.

Run the repeatable SSR and hydration checks with:

```sh
pnpm vitest run examples/react-vite-ssr
```

## phase boundaries and limitations

- The stable `0.1.0` root contract still owns HTTP-first React SSR. This `0.2.0` example composes
  that contract with the `@fluojs/react/vite` manifest parser added after the initial SSR example.
- `src/entry-client.ts` is the browser-only boundary. Server modules do not access `window` or
  `document`, and the server loads the Vite manifest explicitly from the application boundary.
- Before `@fluojs/react/client` navigation exists, links and forms perform ordinary browser document
  navigation. This example does not promise SPA navigation, event replay, client route matching, or
  navigation caches.
- This is not a Next.js App Router, file-based router, TanStack route tree, RSC example, catch-all
  route example, or production starter-template change.
- The asset controller is intentionally minimal and serves the flat filenames emitted by this
  example's Vite config. A production deployment should normally place built assets behind its
  established static-file or CDN boundary.

## project structure

```txt
examples/react-vite-ssr/
├── src/
│   ├── app.ts              # @Router/@Path page and Vite asset serving module
│   ├── app.test.ts         # DTO, streamed Suspense, and manifest asset assertions
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── entry-server.ts     # Explicit Vite server-entry selector
│   ├── hydration.test.ts   # DOM-equivalent hydration interaction and warning check
│   ├── main.ts             # Loads the generated manifest and starts Fastify
│   ├── page.ts             # Shared server/client document and interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── vite.client.config.ts
├── vite.server.config.ts
├── README.md
└── README.ko.md
```

## related docs

- `../react-stable-ssr/README.md` — the explicit-asset `0.1.0` SSR baseline
- `../../packages/react/README.md` — React package and Vite manifest contracts
- `../../packages/vite/README.md` — TC39 decorator transform boundary for Vite builds
- `../../docs/contracts/behavioral-contract-policy.md` — behavior/docs/test alignment rules
