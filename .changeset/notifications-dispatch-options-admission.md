---
"@fluojs/notifications": patch
---

Capture dispatch options at admission so reusing an options object cannot change an in-flight notification's delivery route, lifecycle publication, signal reference, or batch failure policy. Preserve cancellation through the original live AbortSignal and existing defaults.
