---
"@fluojs/discord": patch
---

Correct `DiscordService.sendMany()` handling of transport receipts with `ok: false`.
The default mode (including `continueOnError: false`) now rejects with
`DiscordTransportError` before sending later messages. With `continueOnError: true`,
the failed input message and error are recorded in `failures` and `failed`, later
messages are attempted, and only successful receipts enter `results` and `succeeded`.
Errors omit provider response details. Single-message `send()` continues to return
`ok: false` receipts, and receipts without `ok` still normalize to successful results.
