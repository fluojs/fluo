---
"@fluojs/core": patch
"@fluojs/cqrs": patch
---

Make internal payload cloning deterministic by always preserving supported nested class prototypes, own symbol properties, and circular references, regardless of runtime structuredClone behavior. Document the shared clone contract and CQRS value-object isolation; functions remain shared references, while Buffer and private-field behavior remains unspecified pending #4015.
