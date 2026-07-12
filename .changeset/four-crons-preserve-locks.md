---
"@fluojs/cron": major
---

Preserve distributed lock lifecycle contracts by validating enabled lock TTLs before Redis I/O, bounding shutdown lock release attempts, retaining local ownership when release I/O times out, and returning immutable scheduling descriptor snapshots.

Migration notes:

- Configure every enabled module-level `distributed.lockTtlMs` and enabled task-level `lockTtlMs` as an integer of at least `1_000ms` before module registration.
- Treat values from `SchedulingRegistry.get()` and `getAll()` as immutable snapshots. Use `enable()`, `disable()`, `remove()`, `updateCronExpression()`, or `updateIntervalMs()` instead of mutating descriptors or scheduler handles.
- Review `shutdown.timeoutMs` against expected Redis latency. Owned-lock release I/O now stops waiting at that boundary and preserves local ownership visibility when the release cannot be confirmed in time.
