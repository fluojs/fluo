---
"@fluojs/discord": patch
---

Correct the Discord notification routing documentation: one non-blank recipient takes precedence over the configured default thread, multiple non-blank recipients are rejected, and a valid message with neither a recipient nor a default thread is passed to the transport without a thread ID. Runtime behavior is unchanged.
