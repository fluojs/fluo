---
"@fluojs/cli": patch
---

Resolve runtime and interactive prompt dependencies only at their command boundaries so the CLI installs and runs non-interactive commands across its documented Node.js `>=20.0.0` range.
