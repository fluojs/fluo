---
"@fluojs/http": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-cloudflare-workers": patch
"@fluojs/platform-deno": patch
"@fluojs/runtime": patch
---

Keep manual SSE dispatch active through stream close or abort. Late client aborts no longer
emit request-success observation, custom Web response factories remain compatible without
`responseReady`, and Cloudflare Worker ownership now waits for both response-body termination
and dispatcher completion.
