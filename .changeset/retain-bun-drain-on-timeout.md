---
"@fluojs/platform-bun": major
---

`close()` does not force teardown when its bounded shutdown timeout expires. The timeout rejects only the caller-facing `close()` promise while accepted work and adapter state remain until Bun termination and request drain complete. Operators that relied on teardown at the timeout must configure their supervisor or process manager with a hard-kill policy after its grace period; do not rely on the adapter timeout to terminate the process.
