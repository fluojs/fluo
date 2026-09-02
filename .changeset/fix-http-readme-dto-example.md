---
"@fluojs/http": patch
---

Correct the README Quick Start DTO example so the documented snippet compiles with the Babel decorator configuration Fluo ships. Decorated DTO fields are now initialized instead of using a definite assignment assertion, and both READMEs state that constraint.
