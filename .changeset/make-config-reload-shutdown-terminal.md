---
"@fluojs/config": patch
---

Make `ConfigReloadManager` shutdown terminal so a retained manager cannot reactivate disposed reload resources.

After `close()` or `onModuleDestroy()`, the manager no longer creates a replacement reloader or env-file watcher: `reload()`, `subscribe()`, and `subscribeError()` throw an `InvariantError`, `onApplicationBootstrap()` becomes a no-op, and `current()` keeps returning the last committed `ConfigService` snapshot. This restores the documented watcher-cleanup guarantee, which was previously reversible through the public manager surface.
