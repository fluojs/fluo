---
"@fluojs/http": minor
"@fluojs/runtime": minor
"@fluojs/platform-nextjs": minor
"@fluojs/platform-cloudflare-workers": minor
---

Add opt-in bounded text and custom body parsing without rewriting Content-Type
or reconstructing Requests. HTTP owns BodyParser and BodyParserContext; runtime
Web helpers implement byte-limited materialization, and Next plus the existing
Workers Web option inheritance expose it. Custom parsers may delegate unchanged
MIME behavior with context.parseDefault(). Existing default JSON/multipart and
HEAD policies remain unchanged. Text mode does not guarantee authentication
order: authenticate explicitly before application-owned JSON interpretation.
