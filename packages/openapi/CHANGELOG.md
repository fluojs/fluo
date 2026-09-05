# @fluojs/openapi

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3529](https://github.com/fluojs/fluo/pull/3529) [`a0dbddf`](https://github.com/fluojs/fluo/commit/a0dbddf8e174eb9d1ce550f872154642fe06152c) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/openapi` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement. The package API and runtime behavior are unchanged by this engine metadata alignment.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3073](https://github.com/fluojs/fluo/pull/3073) [`8453bc9`](https://github.com/fluojs/fluo/commit/8453bc93308f9d6ebff82eeab8ec0bcbdd401c37) Thanks [@ayden94](https://github.com/ayden94)! - Reject unsupported handler methods and transformed Path Item keys instead of emitting invalid OpenAPI 3.1 documents.

  Migration: Before upgrading, replace `ALL` or custom handler descriptors with supported HTTP method descriptors or exclude them from OpenAPI input. Remove nonstandard Path Item keys such as `all` and `query` from `documentTransform`; retain only standard operations, fixed fields, and `x-*` extensions.

### Minor Changes

- [#3537](https://github.com/fluojs/fluo/pull/3537) [`19cd492`](https://github.com/fluojs/fluo/commit/19cd492007bc8e99aa91fbe606487cfd14ea3843) Thanks [@ayden94](https://github.com/ayden94)! - Support TRACE handler descriptors as standard OpenAPI 3.1 Path Item operations.

### Patch Changes

- [#3536](https://github.com/fluojs/fluo/pull/3536) [`2d69e79`](https://github.com/fluojs/fluo/commit/2d69e7967c5de9c1153f39ccd131c96497ab993a) Thanks [@ayden94](https://github.com/ayden94)! - Document NestJS OpenAPI migration differences for default error response injection, generated operation IDs, and async registration route options.

- [#2825](https://github.com/fluojs/fluo/pull/2825) [`70d68be`](https://github.com/fluojs/fluo/commit/70d68beda59f17605076de7b29f598db8867be7f) Thanks [@ayden94](https://github.com/ayden94)! - Emit OpenAPI 3.1 numeric exclusive bounds from compatible boolean metadata instead of forwarding invalid boolean keywords.

- [#3532](https://github.com/fluojs/fluo/pull/3532) [`84a2a55`](https://github.com/fluojs/fluo/commit/84a2a55ecdf2dc0e27386ed02a7cd18c5bc5d4bf) Thanks [@ayden94](https://github.com/ayden94)! - Generate required string path parameters from route templates when request DTO bindings and explicit parameter metadata are absent.

- [#2926](https://github.com/fluojs/fluo/pull/2926) [`c8f14e5`](https://github.com/fluojs/fluo/commit/c8f14e5fd0d7c2adada52ffbf3b42027c5501261) Thanks [@ayden94](https://github.com/ayden94)! - Normalize accepted legacy `nullable` schema metadata into valid OpenAPI 3.1 null unions.

- [#3016](https://github.com/fluojs/fluo/pull/3016) [`589258e`](https://github.com/fluojs/fluo/commit/589258ee628c1d43ed1ebf3d41bd4f707d2dd81c) Thanks [@ayden94](https://github.com/ayden94)! - Rebuild the published OpenAPI runtime so custom document and UI paths plus OpenAPI 3.1 schema normalization match the source contract.

- [#3535](https://github.com/fluojs/fluo/pull/3535) [`ba124a8`](https://github.com/fluojs/fluo/commit/ba124a8f9646060b24681332b51799d20c896de7) Thanks [@ayden94](https://github.com/ayden94)! - Remove the stale `@fluojs/validation` runtime dependency. OpenAPI consumes DTO metadata through `@fluojs/core/request-pipeline`.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`06c5c62`](https://github.com/fluojs/fluo/commit/06c5c620ae821fb4181ea019cb16d3756d1fa81a), [`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`c6b0af7`](https://github.com/fluojs/fluo/commit/c6b0af7926e1f94b36ead0ed2678dbd984790ac6), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`eb0ee7f`](https://github.com/fluojs/fluo/commit/eb0ee7fc97bb174607fa87f2deeb93ebd46d6340), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`8e191c2`](https://github.com/fluojs/fluo/commit/8e191c2c9664bf58b402875b7a40b02b5ade012e), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`81e4fb5`](https://github.com/fluojs/fluo/commit/81e4fb5743d83e286fc3d3dac6999ce281c2a9a3), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`9380550`](https://github.com/fluojs/fluo/commit/9380550c6986dd8af05896899c2b1c5814c7db79), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`0d130d5`](https://github.com/fluojs/fluo/commit/0d130d5210ee3b4a02811aedd4f86bcc06818a7d), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`1ecaea2`](https://github.com/fluojs/fluo/commit/1ecaea2bfe3f9fa5c229fe5707e2b6c94378136b), [`b6343ea`](https://github.com/fluojs/fluo/commit/b6343ea89db7d7131aded2d3b829425046e70a1b), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`8354f8c`](https://github.com/fluojs/fluo/commit/8354f8cb3b038ff85948296e18bb97880a291389), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`2aef2a7`](https://github.com/fluojs/fluo/commit/2aef2a7cabe819e32b6bcc07ebc3ecbad34cc049), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`44125db`](https://github.com/fluojs/fluo/commit/44125db098f68fc751bc5300c5abe7036a403736), [`50a22dd`](https://github.com/fluojs/fluo/commit/50a22dd22774eedfa4847e81d22f6cb592d2a30e), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`ac6e32c`](https://github.com/fluojs/fluo/commit/ac6e32c0e108e236800c497342d8e5e66b9175a9), [`605a0fc`](https://github.com/fluojs/fluo/commit/605a0fcd1194332d51694f7e59323c897fe5c566), [`2dc5ee8`](https://github.com/fluojs/fluo/commit/2dc5ee8771e4b6dfb24a740e44bae0000bee1409), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`78b0a8f`](https://github.com/fluojs/fluo/commit/78b0a8fb59e69a4526f247211f0eb244f4a3abd2), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`1817f04`](https://github.com/fluojs/fluo/commit/1817f04a2629f05147faea76cd3615cf1cca28ac), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`19a1abe`](https://github.com/fluojs/fluo/commit/19a1abe728bda9dae7c2eb90b4174ca4e2b15cf8), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c)]:
  - @fluojs/http@3.0.0
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0

## 1.1.0

### Minor Changes

- [#2723](https://github.com/fluojs/fluo/pull/2723) [`6534715`](https://github.com/fluojs/fluo/commit/65347155a09c169e465b58215c1033d2bbfc8aba) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable OpenAPI JSON and Swagger UI routes with preserved defaults, multi-document module support, and deterministic bootstrap failures for normalized route collisions.

### Patch Changes

- [#2299](https://github.com/fluojs/fluo/pull/2299) [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896) Thanks [@ayden94](https://github.com/ayden94)! - Add the documented `@fluojs/core/request-pipeline` metadata integration seam and migrate validation, serialization, and OpenAPI internals to it instead of importing `@fluojs/core/internal` directly.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`bfc2aeb`](https://github.com/fluojs/fluo/commit/bfc2aebb3a2dd03c2ce0509585bca4b5d78a5588), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`2c09f35`](https://github.com/fluojs/fluo/commit/2c09f3541a6ffb33a26e045f531fbecbabd5dfe7), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`e6d0c70`](https://github.com/fluojs/fluo/commit/e6d0c70868a520dd2a4379789dc5ccbfb1e01351), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`2854c36`](https://github.com/fluojs/fluo/commit/2854c366d99c191eae3416e375b9db577711aaff), [`94f6518`](https://github.com/fluojs/fluo/commit/94f6518bf26b6bb412759c48d043e05e153ce533), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`a951bc1`](https://github.com/fluojs/fluo/commit/a951bc195261331810bc8791df1041ab51d14ebb), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/http@2.0.0
  - @fluojs/validation@1.0.6
  - @fluojs/core@1.1.0

## 1.0.3

### Patch Changes

- [#1987](https://github.com/fluojs/fluo/pull/1987) [`bde2330`](https://github.com/fluojs/fluo/commit/bde2330a6fe833ef7447a668cdf984c51ca9d1f9) Thanks [@ayden94](https://github.com/ayden94)! - Harden OpenAPI descriptor and document snapshots so caller-owned descriptor mutations and served-document mutations cannot alter generated module state.
  Document and test the adjacent GraphQL websocket shutdown and cache Redis namespace contracts covered by the request-pipeline audit.
- Updated dependencies [[`d675879`](https://github.com/fluojs/fluo/commit/d675879e7401c248baff4576974bc519c2aa6629), [`45b50e6`](https://github.com/fluojs/fluo/commit/45b50e649b5f3a833555523c20b11d3bb0a07f5b), [`494c6f6`](https://github.com/fluojs/fluo/commit/494c6f667e0487c149124b5af28a720f22cd9016), [`3dddc88`](https://github.com/fluojs/fluo/commit/3dddc88748bd3fac07cc059ff79b2995fe9292b0)]:
  - @fluojs/core@1.0.3
  - @fluojs/runtime@1.1.1
  - @fluojs/validation@1.0.4
  - @fluojs/http@1.1.0

## 1.0.2

### Patch Changes

- [#1863](https://github.com/fluojs/fluo/pull/1863) [`daee854`](https://github.com/fluojs/fluo/commit/daee854ca5bc022297f38c412ab019c3f6450bdc) Thanks [@ayden94](https://github.com/ayden94)! - Deduplicate generated OpenAPI operations by path and method so explicit descriptors consistently take precedence over discovered sources and operation IDs remain unique.

- Updated dependencies [[`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1
  - @fluojs/validation@1.0.1

## 1.0.0

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- d0dbdd3: Align generated OpenAPI response media types and stacked security scopes with the shipped HTTP decorator contract.
- 6ae99f8: Align implicit OpenAPI success response statuses with HTTP route defaults so undocumented POST responses are generated as 201 instead of 200.
- afc7dec: Snapshot OpenAPI module options at registration/resolution time and allow Swagger UI assets to be configured for deterministic self-hosted documentation pages.
- 101a38c: Align the documented OpenAPI request/schema surface with typed regression coverage for explicit schema keywords.
- Updated dependencies [01d5e65]
- Updated dependencies [4fdb48c]
- Updated dependencies [72462e3]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [b15ac1b]
- Updated dependencies [1dda8b5]
- Updated dependencies [3f70169]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [65a08db]
- Updated dependencies [93fc34b]
- Updated dependencies [a625716]
- Updated dependencies [45e0f1b]
- Updated dependencies [b82b28f]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [16420f9]
- Updated dependencies [53a2b8e]
- Updated dependencies [e1bce3d]
- Updated dependencies [3baf5df]
- Updated dependencies [7b50db8]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [28ca2ef]
- Updated dependencies [d3504c6]
- Updated dependencies [8422e56]
  - @fluojs/http@1.0.0
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/validation@1.0.0

## 1.0.0-beta.7

### Patch Changes

- [#1628](https://github.com/fluojs/fluo/pull/1628) [`6ae99f8`](https://github.com/fluojs/fluo/commit/6ae99f866e27a5dceed1dfd987348e86744c36e5) Thanks [@ayden94](https://github.com/ayden94)! - Align implicit OpenAPI success response statuses with HTTP route defaults so undocumented POST responses are generated as 201 instead of 200.

- Updated dependencies [[`b15ac1b`](https://github.com/fluojs/fluo/commit/b15ac1bacccf53b39862ef0243182107840e9a3a), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`65a08db`](https://github.com/fluojs/fluo/commit/65a08db23814e2234bf5739fecf04f710b02a996), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/validation@1.0.0-beta.4
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.6

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/http@1.0.0-beta.10
  - @fluojs/validation@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.5

### Patch Changes

- [#1516](https://github.com/fluojs/fluo/pull/1516) [`afc7dec`](https://github.com/fluojs/fluo/commit/afc7decf9f68ea7fa3481a121582650b07bd2136) Thanks [@ayden94](https://github.com/ayden94)! - Snapshot OpenAPI module options at registration/resolution time and allow Swagger UI assets to be configured for deterministic self-hosted documentation pages.

- Updated dependencies [[`c5aebdf`](https://github.com/fluojs/fluo/commit/c5aebdfe141bda72a6701516c48ace0f5caf5ee2), [`f8d05fa`](https://github.com/fluojs/fluo/commit/f8d05fac610bd5a58c27f84e764338ee718c0a67), [`6b8e8a9`](https://github.com/fluojs/fluo/commit/6b8e8a9d2c6123d9a1ca2ec805ef4fde97d1f199), [`8422e56`](https://github.com/fluojs/fluo/commit/8422e566e4d22b466542ef457d36c2e99e1a634a)]:
  - @fluojs/core@1.0.0-beta.3
  - @fluojs/runtime@1.0.0-beta.9
  - @fluojs/validation@1.0.0-beta.2

## 1.0.0-beta.4

### Patch Changes

- [#1444](https://github.com/fluojs/fluo/pull/1444) [`d0dbdd3`](https://github.com/fluojs/fluo/commit/d0dbdd3e3e019cb4deaa03c1984cb15a038d5343) Thanks [@ayden94](https://github.com/ayden94)! - Align generated OpenAPI response media types and stacked security scopes with the shipped HTTP decorator contract.

- Updated dependencies [[`72462e3`](https://github.com/fluojs/fluo/commit/72462e34b4e5f41ff46ca8a98dce2f35d0ead5a0), [`48a9f97`](https://github.com/fluojs/fluo/commit/48a9f9761c093e6622922719869a29a84f7d0079), [`53a2b8e`](https://github.com/fluojs/fluo/commit/53a2b8e5206937f10f0be947179d9ae6390c1a27), [`69936b1`](https://github.com/fluojs/fluo/commit/69936b13ff6ff8c12c90f025213d6dce8ebb2946), [`35f60fd`](https://github.com/fluojs/fluo/commit/35f60fd7dff3c1271e839f3a046b6c66fccbb08f)]:
  - @fluojs/http@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.5

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/http@1.0.0-beta.2

## 1.0.0-beta.2

### Patch Changes

- [#1350](https://github.com/fluojs/fluo/pull/1350) [`101a38c`](https://github.com/fluojs/fluo/commit/101a38c1721d28bd88f4c86b2bc23aad87d4a6c7) Thanks [@ayden94](https://github.com/ayden94)! - Align the documented OpenAPI request/schema surface with typed regression coverage for explicit schema keywords.

- Updated dependencies [[`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/runtime@1.0.0-beta.2
