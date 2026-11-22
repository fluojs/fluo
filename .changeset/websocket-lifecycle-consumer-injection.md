---
"@fluojs/websockets": patch
---

Export each runtime module's public WebSocket lifecycle token so application providers can inject the shared room service through the documented constructor DI path. Keep internal runtime options private and preserve the existing lifecycle instance and direct container resolution.
