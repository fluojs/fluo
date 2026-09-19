---
"@fluojs/cron": major
---

Make the dynamic registry's first `name` argument the sole task, scheduler, and
default distributed-lock identity. Remove dynamic `options.name`, require an
explicit object for `CronModuleOptions.distributed`, and remove public cron-only
metadata aliases, metadata writers, and normalized-option internals.

Migration: move every dynamic task identity to the first argument of
`addCron`, `addInterval`, or `addTimeout`; replace boolean distributed settings
with `distributed: { enabled: true }` or omit the option; and use
`getSchedulingTaskMetadata(...)`, `getSchedulingTaskMetadataEntries(...)`, and
`schedulingMetadataSymbol` for metadata integration.
