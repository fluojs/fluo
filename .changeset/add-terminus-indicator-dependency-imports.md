---
"@fluojs/terminus": minor
---

Add `TerminusModule.forRoot({ imports })` so DI-backed Prisma, Drizzle, and named Redis indicator providers can resolve dependency tokens owned by ordinary sibling modules. Terminus registers `indicatorProviders` in its own module scope, so a dependency module imported only into the surrounding application module was invisible to the indicators; a required token that no imported or global module supplies now fails module-graph validation during bootstrap instead of letting the application start and fail every `/health` and `/ready` request.
