---
"@fluojs/config": patch
"@fluojs/event-bus": patch
---

Separate internal dotenv parsing and variable expansion from configuration loading, and consolidate EventBus dispatch registration and cleanup while preserving caller results, rejections, and shutdown drain ownership.
