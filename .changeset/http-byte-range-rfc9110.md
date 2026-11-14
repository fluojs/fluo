---
"@fluojs/http": minor
"@fluojs/testing": minor
---

Align single-byte ranges with RFC 9110: apply Range only to GET representations
whose effective ordinary response status is 200, preserve route and handler
non-200 statuses, and clamp arbitrary-length decimal end offsets and suffix
lengths to the selected representation without precision loss.

Migration: HEAD now ignores Range and returns complete representation metadata
instead of mirroring a partial GET response. A successful six-byte representation
returns 200 with Content-Length: 6, no Content-Range, and no body or stream-factory
invocation. Use GET to inspect a selected range. Conditional and bodyless status
decisions retain precedence. Static assets and explicit byte-range writers use
the same semantics.

Update the published listener and fetch portability harnesses to enforce full
HEAD framing, effective-200-only selection, and oversized-endpoint clamping.
