# Migrate React type generation

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-typegen.ko.md"><kbd>한국어</kbd></a></p>

## Keep one application graph

Upgrade React, HTTP and CLI together. Artifact version 2 extends the existing
`fluo typegen`; version 1 output is unsupported, not silently upgraded by check.
Keep runtime `FluoFactory.create(AppModule, applicationOptions)` then `app.listen()`.
Export that same options object from the selected module for `--options`; do not
duplicate converter/version settings or import a listener-starting main entry.

```bash
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts --check
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts --watch
```

Use the actual application tsconfig, including its type-only dependencies and
browser components. Omit `--options` only when runtime also uses default options.
Generation owns bootstrap/close, not listen. It preserves atomic publication,
`UNCHANGED` no-rewrite, serialized watch and last-valid output on failure.

## Replace copies with generated consumers

1. Keep HTTP DTO bindings as the input authority. Use DTO property names in typed
   query calls; builders emit source aliases. Required bindings remain required
   even with an initializer; `@Optional()` permits omission. Declare converted
   wire text with type-only `HttpWire<Server, Wire>` from `@fluojs/http`, including
   global conversion. HTTP still validates/converts every request.
2. Import `reactPageRoutes` for `href`, `link`, `push`, `replace`. Query follows
   path params when present. Keep ordinary `Link`/`useRouter`; do not build a
   client matcher or cast `useSearchParams()` into a validated DTO.
3. Preserve literal `module` and concrete results from `ReactNavigationPage.create`.
   Default-export a browser function component with finite JSON props. Include
   the generated `ReactPagePropsRegistry` in strict typechecking. Pass
   `reactPageModules` to the initial loader's fourth argument and soft loader's
   `contracts` option through the existing composition, including prefetch.
   Type-only registry inclusion alone does not wire runtime decoders.
4. Replace copied form Input/alias maps with `reactFormRoutes[id].contract` in
   the existing `useForm`. Return literal-inferred `ReactModule.formResult({
   destination, followUp, data })` after persistence. Do not cast saved data or
   add a form/provider. This supplies `fields`/`decodeSaved`, not GET `decodeRead`.

## Fail before ordinary typecheck and build

Put the same `--check` command first in both existing scripts, joined with `&&`.
Do not replace it with write-mode generation. Missing/stale/malformed/unsupported
output must block ordinary typechecking and production build (exit `2`/`3`/`4`/`5`);
generation/configuration failure is `1`. Fix the source/configuration, explicitly
generate, review the artifact and rerun check. Type-only/config/compiler inputs
participate in freshness even if the emitted runtime would otherwise look unchanged.

Verify positive and negative strict consumers, real query and POST HTTP round trips,
and direct hydration, navigation, enhanced forms and JS-disabled POST/303/GET in
dev/production browsers. Saved/read-failed and uncertain persistence remain distinct;
only GET is retried. Auth/session and public-only prefetch restrictions do not change.

Supported JSON shapes, URI provenance, rejected header/media/custom versions and
diagnostics are defined by the [end-to-end types contract](../contracts/react-end-to-end-types.md).
These are consumer verification steps, not a receipt that this migration ran them.
