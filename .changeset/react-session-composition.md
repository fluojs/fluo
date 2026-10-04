---
"@fluojs/react": minor
---

Extend the canonical progressive form path with literal-preserving saved JSON
data, a shared generated form contract decoder, and an explicit optional
application session outcome. Native POST/303/GET and negotiated v1 remain.
Consumers may pass a generated `contract` to `useForm` instead of copying input
names or casting saved data. Malformed contract data is protocol uncertainty.

Reject Date, nonfinite numbers, classes, functions, serialization hooks/accessors,
undefined members, sparse arrays and cycles at the root saved-data boundary rather
than silently changing their claimed values. Native success stays 303.
