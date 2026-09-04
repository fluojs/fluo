---
"@fluojs/runtime": minor
"@fluojs/studio": minor
---

Add explicit `graphNodeId` correlation to Runtime-produced Studio route descriptors and consume it in the Studio route panel without changing existing graph node IDs. Studio continues to parse persisted legacy route descriptors that omit the field by materializing the previous route-node ID convention at the wire boundary.
