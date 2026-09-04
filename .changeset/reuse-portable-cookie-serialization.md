---
"@fluojs/http": patch
"@fluojs/passport": patch
"@fluojs/testing": patch
---

Reuse the portable HTTP cookie serializer for Passport authentication cookies while preserving established defaults, attribute ordering, and append behavior. Values such as `token with spaces` now emit as `token%20with%20spaces`, and invalid cookie names or attributes fail the portable serializer's validation instead of producing malformed headers.
