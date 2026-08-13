---
'@fluojs/cqrs': patch
---

Reject nested saga dispatch that would re-enter an active singleton provider token through a different event route, preserving serialized saga ownership without deadlocking the in-process publish chain.
