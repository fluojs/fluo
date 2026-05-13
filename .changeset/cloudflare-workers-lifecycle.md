---
"@fluojs/platform-cloudflare-workers": patch
---

Keep Cloudflare Worker websocket upgrades behind the same listen boundary as HTTP dispatch and return shutdown responses for follow-up requests after the adapter closes.
