---
"@fluojs/platform-cloudflare-workers": patch
---

Keep Cloudflare Worker websocket upgrades behind the same listen boundary as HTTP dispatch, return shutdown responses for follow-up requests after the adapter closes, and reject `listen()` with the Cloudflare Workers adapter shutdown-draining error while `close()` is still draining active requests.
