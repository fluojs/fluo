---
"@fluojs/redis": patch
---

Allow unnamed Redis registrations and named `default` registrations to coexist with separate clients and facades. Preserve duplicate rejection for unnamed registrations and matching trimmed names across compatible package copies, existing token identities, and the shared `redis.default` diagnostic label. Cover explicit module visibility options at the ioredis constructor boundary.
