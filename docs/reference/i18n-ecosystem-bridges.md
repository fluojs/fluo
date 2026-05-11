# i18n ecosystem bridge decision record

<p><strong><kbd>English</kbd></strong> <a href="./i18n-ecosystem-bridges.ko.md"><kbd>한국어</kbd></a></p>

This record evaluates whether `@fluojs/i18n` should add first-party bridge surfaces for NestJS i18n, i18next, next-intl, and request/validation convenience glue.

## Decision

`@fluojs/i18n` keeps its root package framework-agnostic. Ecosystem parity work is accepted as **documentation and migration guidance first**, with runtime bridge helpers allowed only when they are opt-in, subpath-scoped, dependency-isolated, and covered by contract tests.

No new runtime subpath is introduced by this decision record. The currently supported first-party integration surfaces remain:

- `@fluojs/i18n/icu` for ICU MessageFormat formatting.
- `@fluojs/i18n/http` for HTTP `RequestContext` locale metadata.
- `@fluojs/i18n/adapters` for caller-owned non-HTTP locale resolution.
- `@fluojs/i18n/validation` for explicit validation issue localization.
- `@fluojs/i18n/loaders/fs`, `@fluojs/i18n/loaders/remote`, and `@fluojs/i18n/typegen` for catalog ingestion and type generation.

## Bridge classification

| Ecosystem bridge | Status | First-party scope | Boundary that must not move |
| --- | --- | --- | --- |
| NestJS i18n parity | Documentation-first | Provide migration notes that map NestJS concepts to fluo modules, explicit locale passing, `@fluojs/i18n/http`, and `@fluojs/i18n/validation`. A future `@fluojs/i18n/nestjs-parity` helper may be considered only for pure catalog/config-shape conversion. | Do not require `experimentalDecorators`, `emitDecoratorMetadata`, reflection metadata, Nest container assumptions, or implicit request locale globals. |
| i18next interop | Extension point | Keep guidance focused on catalog/provider interop through existing loaders and application-owned conversion. A future subpath may expose pure catalog conversion helpers if demand repeats. | Do not make the root package depend on i18next, mutate i18next global instances, or change fluo fallback semantics to match i18next defaults. |
| next-intl workflows | Guidance-only for now | Document shared catalog workflows between frontend applications and backend fluo services. Use loaders/typegen for catalog exchange when needed. | Do not put React, Next.js routing, server component, or middleware assumptions inside `@fluojs/i18n`. |
| Request locale + validation convenience | Existing surfaces | Compose `@fluojs/i18n/http` or `@fluojs/i18n/adapters` with `@fluojs/i18n/validation` in application code. Add a convenience helper only if it stays opt-in and does not make validation HTTP-only. | Validation localization must continue to receive the selected locale explicitly and must not read request state or globals by itself. |

## Acceptance criteria for future bridge helpers

A bridge helper can graduate from guidance to first-party runtime surface only when all of these are true:

1. It is published under a dedicated subpath or dedicated package, never from the `@fluojs/i18n` root export.
2. It has no import-time registration side effects and no direct `process.env` reads.
3. Its dependencies are optional or isolated so the root package stays portable across Node.js, Bun, Deno, Cloudflare Workers, and browser-oriented bundles.
4. Its README section documents the runtime behavior, unsupported assumptions, and migration limits.
5. Regression tests cover catalog conversion, locale fallback behavior, invalid input handling, and dependency isolation.
6. Public exports follow the repository TSDoc baseline.
7. Any behavior-changing public package release includes an appropriate Changeset.

## Recommended user path

- Migrating from NestJS i18n: start with `I18nModule.forRoot(...)`, use `@fluojs/i18n/http` to bind request locale explicitly, and use `@fluojs/i18n/validation` after validation fails instead of relying on global request context.
- Sharing catalogs with i18next or next-intl: keep catalog conversion in application tooling, then load the resulting `I18nMessageTree` through the core service or loader subpaths.
- Building a third-party bridge: follow the [Third-Party Extension Contract](../contracts/third-party-extension-contract.md) and expose explicit module/config APIs rather than import-time patching.

## Contract impact

This decision record does not change runtime behavior and does not add a new public export. It clarifies the compatibility boundary for future bridge proposals while preserving the current documented root package limitation.
