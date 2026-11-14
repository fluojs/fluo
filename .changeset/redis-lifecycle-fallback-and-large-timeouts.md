---
"@fluojs/redis": patch
---

Wait for asynchronous Redis disconnect completion after a failed or timed-out QUIT, with a finite cleanup deadline that preserves the original failure if the client does not close. Honor lifecycle connect and quit timeouts above 2,147,483,647 ms without host timer overflow, and cancel remaining timer segments when the operation settles.
