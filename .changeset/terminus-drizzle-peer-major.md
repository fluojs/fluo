---
"@fluojs/terminus": major
---

Version Terminus together with the Drizzle 3 peer dependency transition. Terminus
keeps its health indicator API and runtime behavior, but its optional
`@fluojs/drizzle` peer now targets the new major rather than Drizzle 2.

Migration: Applications using Terminus Drizzle health indicators must upgrade
`@fluojs/drizzle` to 3 alongside Terminus 3. Keep one unnamed default Drizzle
registration and assign distinct names to additional registrations; inject
additional clients through their matching `getDrizzle*Token(name)` tokens.
Applications not using the optional Drizzle integration do not need to install
Drizzle. The Prisma and Redis integrations remain available.
