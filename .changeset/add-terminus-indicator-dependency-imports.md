---
"@fluojs/terminus": minor
---

Add `TerminusModule.forRoot({ imports })` so DI-backed Prisma, Drizzle, and named Redis indicator providers can resolve dependency tokens owned by ordinary sibling modules. Terminus registers `indicatorProviders` in its own module scope, so a dependency module imported only into the surrounding application module is invisible to the indicators. A missing required named Redis token fails module-graph validation during bootstrap, while missing optional Prisma or Drizzle owner modules let the application bootstrap and report the corresponding indicator as `down` at health-check request time.
