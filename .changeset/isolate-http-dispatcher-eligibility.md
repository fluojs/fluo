---
'@fluojs/http': patch
---

Isolate fast-path eligibility per dispatcher so shared handler mappings cannot select the wrong request pipeline, and freeze the exposed eligibility diagnostics.
