---
"@fluojs/cli": minor
---

Keep the generated React development document and Vite WebSocket alive while
server-only edits drain and replace the Fastify app behind a stable HTTP gateway.
Failed bootstrap stays unavailable until the next corrective save; shared
server/client graph changes may reload the document after readiness.

Existing generated projects are not rewritten by a CLI upgrade. Follow
`docs/getting-started/migrate-react-dev-hmr.md` to move WebSocket ownership to
the CLI development gateway, use an ephemeral app listener, and display the
temporary 503/retry status to clients.
