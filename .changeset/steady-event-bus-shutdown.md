---
'@fluojs/event-bus': major
---

Keep non-blocking local handler and transport publish work in the bounded shutdown drain before closing the configured transport.

Migration note: applications that publish with `waitForHandlers: false` should now expect `app.close()` to wait for that background handler and transport work for up to `shutdown.drainTimeoutMs` (5000ms by default) before transport cleanup continues. Keep background work bounded or configure a shutdown drain budget appropriate for the application.
