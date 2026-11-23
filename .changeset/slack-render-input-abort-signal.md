---
"@fluojs/slack": patch
---

Forward the caller's abort signal into Slack template rendering: `SlackTemplateRenderInput` gains an optional `signal` field and `SlackService.sendNotification(...)` passes the original caller signal to `renderer.render(...)`. Renderers that ignore the new optional field keep compiling and behaving unchanged; renderers that observe it can return early on cancellation while `sendNotification(...)` still rejects with `AbortError` before any transport call.
