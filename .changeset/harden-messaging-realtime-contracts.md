---
"@fluojs/slack": patch
"@fluojs/socket.io": patch
"@fluojs/queue": patch
---

Harden messaging and realtime lifecycle contracts by requiring explicit Slack webhook fetch injection, preventing Socket.IO raw server recreation after shutdown starts, preserving portable Socket.IO guard request typing, and deferring Queue metadata setup until decorator execution.
