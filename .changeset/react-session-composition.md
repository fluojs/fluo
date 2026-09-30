---
"@fluojs/react": minor
---

Extend the canonical progressive form path with literal-preserving saved JSON
data, a shared generated form contract decoder, and an explicit optional
application session outcome. Native POST/303/GET and negotiated v1 remain.
Consumers may pass a generated `contract` to `useForm` instead of copying input
names or casting saved data. Malformed contract data is protocol uncertainty.
