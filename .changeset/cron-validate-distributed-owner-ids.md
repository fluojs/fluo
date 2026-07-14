---
'@fluojs/cron': patch
---

Validate explicit Cron distributed `ownerId` before scheduler or Redis lifecycle setup.

`CronModule.forRoot({ distributed: { ownerId } })` now trims the provided `ownerId` during module option normalization and rejects blank, empty, or non-string values before the scheduler or Redis distributed lock lifecycle begins. Previously, invalid or empty owner identifiers could enter Redis lock ownership state despite the distributed-lock contract. Applications that already pass a non-empty string `ownerId` are unaffected; applications relying on blank or whitespace-only `ownerId` values must now provide a valid stable owner identifier or omit `ownerId` to keep the platform-neutral default.