---
"@fluojs/terminus": patch
---

Allow Terminus applications to restrict `/ready` gating to explicit readiness-critical indicator keys while keeping non-critical indicator failures visible in `/health`, and make built-in indicator provider factories repeatable without DI token collisions.
