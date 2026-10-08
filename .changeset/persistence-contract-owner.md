---
"@fluojs/persistence": minor
"@fluojs/core": patch
"@fluojs/runtime": patch
"@fluojs/prisma": patch
"@fluojs/drizzle": patch
"@fluojs/mongoose": patch
---

Extract shared transaction contracts, Result rollback policy, hook settlement,
and active request work into the independent portable `@fluojs/persistence`
package. Existing core, runtime, and ORM public imports remain compatible and
re-export the canonical constructors without wrappers. Driver observation and
native transaction execution remain in their ORM packages.
