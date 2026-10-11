---
'@fluojs/platform-nodejs': patch
---

Cache deferred cookie and query values directly within each request shell instead of constructing additional memoization wrappers. Preserve lazy evaluation, repeated-access identity, request isolation, and synchronous factory failure retry.
