---
'@fluojs/config': patch
---

Align built-in env-file parsing with the documented dotenv inline comment grammar. Strip an unquoted `#` comment even when no whitespace precedes it, so `VALUE=value#comment` loads as `value` instead of including the comment text, while quoted hashes such as `"value#kept"` remain part of the value across both initial loads and reloads.
