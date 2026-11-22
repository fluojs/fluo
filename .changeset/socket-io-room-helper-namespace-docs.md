---
"@fluojs/socket.io": patch
---

Correct room helper documentation and TSDoc to describe the existing namespace selection and argument contracts: broadcast requires a resolvable namespace, join and leave can locate a socket by ID without handler context, and getRooms accepts only a socket ID for registry lookup. Runtime behavior and public signatures are unchanged.
