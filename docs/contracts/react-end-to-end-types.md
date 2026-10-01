# React End-to-End Types Contract

<p><strong><kbd>English</kbd></strong> <a href="./react-end-to-end-types.ko.md"><kbd>한국어</kbd></a></p>

## One compiler and HTTP path

`fluo typegen` bootstraps the application's actual module and projects its
compiled HTTP descriptors. `--tsconfig` selects the actual application compiler
configuration; `--options` selects an exported application options object from
the same module namespace. Runtime startup and generation share that object.
Generation never listens on an HTTP port.

Scope: stable HTTP-first React tooling, not arbitrary TypeScript schema generation.
Include DTOs and default-exported browser function components in the compiler graph.
`--export` defaults to `AppModule`; without `--tsconfig`, the CLI searches from the
module for `tsconfig.json` and fails if none exists. Without `--options`, bootstrap
uses default options. Select the actual shared options for versioning/converters.
Runtime startup remains `FluoFactory.create(AppModule, applicationOptions)` then
`app.listen()`; the module imported for generation must not start a listener.

```bash
fluo typegen src/app.module.ts --export AppModule \
  --options applicationOptions --tsconfig tsconfig.json \
  --output src/react-pages.ts
fluo typegen src/app.module.ts --export AppModule \
  --options applicationOptions --tsconfig tsconfig.json \
  --output src/react-pages.ts --check
```

One frozen source/configuration snapshot owns a generation. Tooling associates
the actual evaluated controller and DTO constructors with project-relative
declaration kind/path/ordinal identities. It does not match class names,
registration positions, stacks, function source strings or guessed sourcemaps.
Concrete factory instantiations retain their resolved types; unavailable,
ambiguous or unresolved associations fail with a diagnostic. HTTP alone decides
which inherited metadata and overridden handlers are compiled.

Artifact version 2 includes type-only dependencies, compiler configuration and
the TypeScript version in freshness. The output itself is excluded from its
input fingerprint. Watch mode subscribes before bootstrap, refreshes dependency
watches for subsequent generations, preserves the last valid output after a
failure, and disposes owned watchers and active work on shutdown. Publication
is atomic; identical bytes remain `UNCHANGED`. Typecheck/build run `--check`
before their ordinary work and do not silently regenerate stale output.
Missing, stale, malformed and unsupported-version artifacts fail with exit codes
`2`, `3`, `4` and `5`; generation/configuration failures use `1`. Explicit generation
is the repair, not a fallback inside check mode. See the
[migration](../getting-started/migrate-react-typegen.md) and
[toolchain matrix](../reference/toolchain-contract-matrix.md).

## Wire input

HTTP binding metadata supplies logical properties, wire aliases and omission
policy. A default initializer or a TypeScript optional property does not replace
HTTP's `@Optional()` materialization policy.
Missing required bindings fail even with an initializer; only optional bindings
retain their initializer on omission. Path arguments use compiled placeholder
names; query/form contracts use DTO property names and emit their HTTP source
aliases. A raw `useSearchParams()` snapshot is not a validated server DTO.

Use the type-only `HttpWire<Server, Wire>` declaration when conversion erases
the input type:

```ts
import { Convert, FromQuery, type HttpWire } from '@fluojs/http';

class SearchInput {
  @Convert({ convert(value: unknown) { return Number(value); } })
  @FromQuery('page')
  page: HttpWire<number, string> = 1;
}
```

The same declaration covers global converter chains. It installs no converter,
runtime marker or client validator. Generated query builders accept HTTP text
and repeated text, encode aliases using `URLSearchParams`, preserve repeated
value order and empty strings, and omit absent optional values. Numbers and
booleans require an explicit text wire contract instead of implicit stringification.
HTTP validation and conversion remain authoritative.

`href`, `link`, `push` and `replace` take path params first when present, then
query. Query is optional only when all bindings are optional. Keys follow compiled
binding order, not caller object insertion order. Arrays append repeated keys in
element order; an empty array emits no key, `''` emits `key=`, and absent optional
values emit nothing. Paths use `encodeURIComponent`; query uses form URL encoding:
space becomes `+`, literal plus/slash/percent become `%2B`/`%2F`/`%25`, and Unicode
and reserved characters follow UTF-8 `URLSearchParams` encoding. No fragment,
relative route or client matcher is generated. For a DTO with `@FromQuery('q') term`:

```tsx
import { Link } from '@fluojs/react/client';
import { reactPageRoutes } from './react-pages.js';

const search = reactPageRoutes['GET /search SearchRouter show'];
<Link {...search.link({ term: 'tea + coffee' })}>Search</Link>;
// href: /search?q=tea+%2B+coffee
```

Unversioned and provenance-backed URI routes generate hrefs from their compiled
effective paths. Versioned header/media/custom routes and missing provenance
are rejected. A literal `/v2` segment never establishes version selection.
HTTP route versions, navigation protocol v2, form protocol v1 and artifact version 2
are independent.

## Browser props and saved data

The generated `reactPageModules` map contains limited JSON `decodeProps`
contracts. The module-to-props registry connects build-mapped module literals
to their authored function components. Initial transfer and soft navigation
use the same contracts after build-identity approval and before destination
import. Importer allowlists remain mandatory.

Include the generated registry in the strict consumer program (`strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
A correct module with incorrect, missing or extra props must fail compilation,
including aliased inputs; a broad overload must not bypass the registry.
The renderer still owns the React tree; only JSON data crosses the wire.

At the loader seam, pass the same map as the fourth argument of
`loadReactInitialNavigationDestination(json, modules, buildId, reactPageModules)`
and as `contracts: reactPageModules` to `loadReactNavigationDestination`.
The official composition must carry it through the existing provider for ordinary
navigation and public prefetch too. Importing the registry alone does not install
runtime validation. Missing contracts or decoder failure produce `invalid-payload`
before import, without bypassing auth/session or public-prefetch approval.

The supported JSON subset is finite plain objects, homogeneous arrays,
discriminated unions, finite numbers, strings, booleans, null and literal
values. Optional properties are omitted, not returned as present `undefined`
properties. `unknown` is validated as JSON and exposed as `ReactJsonValue`,
not promoted to an unchecked domain type. Class values, functions, custom
`toJSON`, positional tuples, open index signatures, recursive type definitions,
`any` and unresolved generic shapes require a source-located correction. Symbol,
bigint, Date/DI instances and required `undefined` are unsupported too. Concrete
generics and finite nested object/array unions are supported; no type is silently
lowered to `any`. Optional object members follow JSON omission; runtime cycles and
non-JSON values are not accepted as domain data. Serialize dates/money explicitly
to strings before returning plain props/data, not through a custom `toJSON`.

Generated `reactFormRoutes` provide an HTTP action href and the existing
`ReactFormContract<Input, Data>` with `{ fields, decodeSaved }`. There is one
`useForm` path and one static `ReactModule.formResult` path:

```ts
import { useForm } from '@fluojs/react/client';
import { reactFormRoutes } from './react-pages.js';

const save = reactFormRoutes['POST /catalog/:sku CatalogRouter edit'];
const form = useForm({
  id: 'edit',
  action: save.href({ sku }),
  contract: save.contract,
  allowDestination: (destination) => destination.startsWith('/catalog/'),
});
```

Consumers do not copy DTO interfaces, field aliases or cast saved data.
Unknown fields fail typechecking. Saved acknowledgement and follow-up read are
separate discriminated states; malformed saved data is protocol uncertainty,
not a typed persistence failure or permission to repeat POST.
`ReactModule.formResult({ destination, followUp, data })` retains literal saved-data
inference; optional explicit `session` still enters the existing session barrier.
`decodeRead` and generated GET decoders are not part of this projection (#3881).
Native POST/303/GET, validation/auth/rejected/uncertain outcomes, successful-control
semantics and GET-only `retryRead()` remain the [form contract](./react-progressive-forms.md).

Generated runtime contains URL construction, aliases and JSON contracts.
Server implementations, DTO constructors, compiler/DI imports and secrets
are not browser dependencies. Shipped declarations and real generated
consumers, including dev/production browser behavior, establish this boundary;
source aliases or `skipLibCheck` alone do not.

## Evidence and verification boundary

Source owners: `packages/http/src/type-projection.ts`,
`packages/cli/src/commands/typegen-compiler.ts`, `typegen-projection.ts`,
`packages/react/src/typegen.ts`, `typegen-runtime.ts`, `navigation-payload.ts`
and `client/navigation-payload.ts`. Focused evidence belongs to
`packages/cli/src/commands/typegen-projection.test.ts`, `typegen-watch.test.ts`,
`packages/http/src/type-projection.test.ts` and
`packages/react/src/client-navigation-payload.test.ts`. These paths define the
verification surfaces, not a claim that packaged dev/production browsers, the
whole issue, performance, soak or the product gate passed in this documentation run.
