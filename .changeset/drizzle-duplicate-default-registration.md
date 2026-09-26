---
'@fluojs/drizzle': major
---

Reject duplicate unnamed `DrizzleModule.forRoot(...)` and `forRootAsync(...)` registrations at bootstrap, before async options factories or lifecycle wrappers can claim a database. Each application container now permits one unnamed default alongside independently owned named clients.

Migration: Applications composing multiple unnamed Drizzle modules must keep one default registration and give every additional module a distinct `name`. Inject additional clients through their matching `getDrizzle*Token(name)` tokens instead of relying on a later unnamed registration replacing the default and its disposal hook. An explicitly named `default` client remains distinct from the unnamed default.
