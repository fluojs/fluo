---
"@fluojs/platform-deno": minor
---

Add `createDenoFetchHandler(...)` so applications can dispatch through an already bootstrapped fluo dispatcher while a surrounding host owns `Deno.serve(...)`, shutdown, signals, and websocket upgrades.
