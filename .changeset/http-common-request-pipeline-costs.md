---
"@fluojs/runtime": patch
---

Avoid repeated Web response header-name searches while the response owns its header map. Reading or replacing the mutable map restores live case-insensitive lookup, preserving direct mutations, original casing, and independent Set-Cookie fields.
