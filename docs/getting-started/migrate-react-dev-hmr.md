# Migrate the Node React starter to development HMR

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-dev-hmr.ko.md"><kbd>한국어</kbd></a></p>

New `fluo new --starter react-vite-ssr` projects run React Fast Refresh and CSS HMR
through the existing `fluo dev` command. No second Vite server or production build is
needed. Existing generated applications are not rewritten by upgrading `@fluojs/cli`.

To opt an existing Node React/Vite application into this path:

1. Upgrade `@fluojs/cli`, install `@vitejs/plugin-react@^6.1.1` as a dev dependency,
   and retain the existing `@fluojs/vite` decorator plugin before `react()` in
   `vite.server.config.ts`. Remove the old development stylesheet stub.
2. Add `src/entry-client-dev.ts` containing `import '@vitejs/plugin-react/preamble'`
   followed by `await import('./entry-client')`. In the development renderer only,
   emit `/@vite/client` and `/src/entry-client-dev.ts` as bootstrap modules; keep
   the production entry and manifest unchanged.
3. Mount the Vite middleware, `/@react-refresh`, and WebSocket upgrade on the same
   Fastify listener. The official generated `src/main.ts` is the reference. Load
   the current page and document modules through `vite.ssrLoadModule(...)` for
   each directly requested page after the HTTP DTO handler runs, without
   replacing `@fluojs/http` matching or validation. Vite injects CSS through
   inline style elements; allow `style-src 'self' 'unsafe-inline'` only in the
   development `securityHeaders` option, keeping production's default CSP.
4. Run `fluo dev` or the generated `pnpm dev` script; edit a component and CSS
   while observing the browser, then request its SSR route directly. Run
   `pnpm build` and `pnpm start` separately to check production hydration.

Only browser modules in Vite's transformed client graph avoid the Node child
restart. Server-only, configuration and non-graph source changes retain the
supervisor restart boundary. React preserves hook/input state only for compatible
component boundaries; hook-order changes, incompatible exports and propagated
full reloads can remount or replace the document. Syntax/transform errors appear
in Vite's browser overlay and terminal; correct the source without restarting
`fluo dev`. `--raw-watch` and `FLUO_DEV_RAW_WATCH=1` retain their native-watch
semantics, not a Fast Refresh guarantee. Bun, Deno and Workers do not gain React
Fast Refresh support from this Node starter change.
