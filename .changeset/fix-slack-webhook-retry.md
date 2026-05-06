---
"@fluojs/slack": patch
---

Stop retrying permanent Slack webhook HTTP failures (such as 403, 404).

Previously, the built-in webhook transport would mistakenly retry all errors if the attempt count had not been exhausted, ignoring the intent to only retry transient (408, 429, 5xx) failures. Now, non-transient HTTP errors correctly throw `SlackTransportError` immediately, aligning with the documented behavioral contract.