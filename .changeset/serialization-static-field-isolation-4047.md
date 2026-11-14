---
"@fluojs/serialization": patch
---

Ignore static field applications of Expose, Exclude, and Transform so they cannot expose, suppress, or transform same-named instance fields, including across inheritance. Preserve instance-only allowlists and ordinary instance decorator behavior without requiring migration.
