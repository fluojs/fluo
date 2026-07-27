---
"@fluojs/react": patch
---

Cancel unfinished SSR and experimental Flight readers when response sinks close or writes fail, releasing reader locks without masking sink errors.
