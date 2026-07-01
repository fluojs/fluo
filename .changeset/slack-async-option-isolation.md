---
"@fluojs/slack": patch
---

Resolve Slack async module options through each application container so reusing one `SlackModule.forRootAsync(...)` module definition cannot leak resolved or rejected configuration across app boundaries.
