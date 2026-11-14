---
"@fluojs/runtime": patch
---

Preserve reserved multipart field names such as `__proto__`, `constructor`, and `toString` as own enumerable data properties. Buffered parsing now retains only submitted values in arrival order without changing the fields object's prototype.
