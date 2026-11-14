---
"@fluojs/http": patch
---

Require an `If-Range` HTTP date to exactly match the selected `Last-Modified` date at one-second precision before applying a byte range. A newer but different date now returns the complete `200` representation instead of `206`, matching RFC 9110 section 13.1.5; exact matches, strong `ETag` validators, and older or malformed dates keep their existing behavior.
