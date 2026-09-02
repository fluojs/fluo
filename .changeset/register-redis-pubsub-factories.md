---
"@fluojs/redis": major
---

Correct Redis Pub/Sub migration examples to register named-token factory providers explicitly.

Migration: Declare each named-token Redis consumer before its owning `@Module(...)` and add it to that module's `providers` array. `@Inject(...)` declares constructor tokens; it does not discover or register a provider class.
