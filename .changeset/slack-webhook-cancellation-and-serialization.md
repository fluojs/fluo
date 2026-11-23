---
"@fluojs/slack": patch
---

Propagate the original error when reading a delivered Slack webhook response body is cancelled instead of returning an empty success receipt, and reject locally unserializable webhook payloads (such as bigint `metadata` values) with `SlackTransportError` before the first `fetch` call instead of retrying them through backoff.
