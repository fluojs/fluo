---
"@fluojs/prisma": patch
---

Share a single Prisma connection attempt across concurrent initialization calls. Shutdown waits for that attempt to finish before disconnecting, and initialization no longer reconnects an already initialized or shutting-down service.
