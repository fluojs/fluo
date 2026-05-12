---
"@fluojs/http": patch
"@fluojs/platform-cloudflare-workers": patch
"@fluojs/platform-deno": patch
"@fluojs/platform-bun": patch
---

Keep fetch-style platform adapter runtime imports off the HTTP root barrel and remove eager Node built-in imports from HTTP request-id/context helpers so edge bundles can instantiate without Node built-in shims.
