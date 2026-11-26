---
"@fluojs/discord": patch
---

Preserve the cancellation reason when a webhook response body read is interrupted, without reporting a successful delivery or retrying the POST. Reject payloads that cannot be serialized to JSON with a redacted `DiscordTransportError` before any request or backoff.
