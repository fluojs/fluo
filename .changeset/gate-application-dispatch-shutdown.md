---
"@fluojs/runtime": patch
---

Reject new `Application.dispatch()` calls once `Application.close()` starts, before they enter the HTTP dispatcher. Requests admitted before shutdown retain their dispatcher-owned drain behavior.

Migration: application-owned direct dispatch callers must finish admission before initiating close. A dispatch attempted after close starts now rejects consistently while teardown is pending, after a failed close, and after successful close.
