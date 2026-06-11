---
"@fluojs/platform-bun": patch
---

Guard Bun adapter lifecycle mutations by keeping duplicate `listen()` calls bound to the original live dispatcher, rejecting realtime binding changes after startup, validating signal shutdown timeouts before registration, and documenting the synchronous fetch-handler contract.
