---
"@fluojs/http": patch
---

Reject managed SSE async iterables when the active adapter does not expose `FrameworkResponse.stream` instead of silently reporting the stream as handled. The dispatcher now surfaces an unsupported-stream failure through the standard dispatch error path before marking the response committed, aligning managed SSE with the documented adapter contract.