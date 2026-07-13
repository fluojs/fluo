---
'@fluojs/platform-bun': major
---

Regenerate the published Bun declarations from current source and verify declaration artifacts structurally before release. `BunWebSocketBinding.fetch(...)` now exposes the documented upgrade-only `BunWebSocketUpgradeHost`; move direct server `fetch(...)`, `stop(...)`, or lifecycle access into the surrounding `Bun.serve(...)` host.
