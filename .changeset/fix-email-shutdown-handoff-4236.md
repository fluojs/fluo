---
"@fluojs/email": patch
---

Prevent cancelled or shutting-down email deliveries from reaching transports after
asynchronous preparation. Drain reentrant provider operations before closing owned
transports, preserve verification failure causes during shutdown, and prevent
failed shutdown initialization from restarting transport creation.
