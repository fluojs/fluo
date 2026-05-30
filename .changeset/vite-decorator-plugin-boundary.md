---
"@fluojs/vite": patch
---

Fix the Vite decorator plugin boundary so application files with `test` or `spec` substrings still transform, keep the public implementation out of `src/internal`, and avoid requesting Babel sourcemaps when Vite build sourcemaps are disabled.
