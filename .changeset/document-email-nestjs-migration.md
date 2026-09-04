---
"@fluojs/email": patch
---

Document the NestJS mailer migration path for explicit transport ownership and
direct or template-backed delivery. Choose a portable transport, a
factory-owned Node SMTP transporter, or a caller-owned existing transporter;
use `EmailService.send(...)` for pre-rendered messages and
`sendNotification(...)` with `payload.templateData` for renderer-backed
notifications.
