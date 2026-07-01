---
"@fluojs/platform-cloudflare-workers": patch
---

Stabilize Cloudflare Workers adapter lifecycle boundaries by rejecting live websocket binding replacement, preserving shutdown JSON responses for websocket upgrades during drains, and allowing lazy entrypoints to bootstrap again after a timed-out close eventually settles.
