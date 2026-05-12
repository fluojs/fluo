---
"@fluojs/terminus": patch
---

Allow Terminus applications to restrict `/ready` gating to explicit readiness-critical indicator keys while keeping non-critical indicator failures visible in `/health`, and harden built-in indicator provider factories with internal unique tokens so repeated same-type `indicatorProviders` do not collide.
