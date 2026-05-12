---
"@fluojs/discord": patch
---

Harden Discord delivery readiness by rejecting sends after bootstrap failure or shutdown races, accepting poll-only payloads, honoring Discord rate-limit retry hints, and documenting the lifecycle/status response surface.
