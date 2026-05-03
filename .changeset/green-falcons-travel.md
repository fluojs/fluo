---
"@fluojs/cli": patch
"@fluojs/runtime": patch
---

Keep colorized application logs consistent between `fluo dev` and `fluo start` by preserving ANSI color intent through the CLI development reporter and runtime console logger.
