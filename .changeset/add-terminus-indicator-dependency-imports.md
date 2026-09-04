---
"@fluojs/runtime": patch
"@fluojs/terminus": minor
---

Add `TerminusModule.forRoot({ imports })` so DI-backed Prisma, Drizzle, and named Redis indicator providers can resolve dependency tokens owned by ordinary sibling modules. Terminus registers `indicatorProviders` in its own module scope, so a dependency module imported only into the surrounding application module is invisible to the indicators. `@fluojs/runtime` now preserves that module isolation for optional tokens: an optional token is `undefined` only when no provider registers it anywhere in the bootstrap graph; an existing but inaccessible sibling token fails module-graph validation with `MODULE_VISIBILITY_ERROR`. A missing required named Redis token and an existing but unimported optional Prisma or Drizzle owner token therefore fail bootstrap, while absent optional Prisma or Drizzle owner modules still let the application bootstrap and report the corresponding indicator as `down` at health-check request time.
