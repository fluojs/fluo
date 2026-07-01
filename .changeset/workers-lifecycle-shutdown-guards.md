---
"@fluojs/platform-cloudflare-workers": patch
"@fluojs/websockets": patch
---

Stabilize Cloudflare Workers adapter lifecycle boundaries by rejecting live websocket binding mutation, preserving shutdown JSON responses for websocket upgrades during drains, and allowing lazy entrypoints to bootstrap again after a timed-out close eventually settles.
