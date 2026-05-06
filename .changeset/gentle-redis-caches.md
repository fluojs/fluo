---
"@fluojs/cache-manager": patch
---

Tighten Redis fractional TTL freshness and HTTP response cacheability boundaries so cache-manager avoids replaying expired Redis entries or non-success GET responses.
