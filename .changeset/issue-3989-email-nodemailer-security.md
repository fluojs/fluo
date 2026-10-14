---
"@fluojs/email": major
---

Require the optional Node SMTP peer `nodemailer@^10.0.9` and resolve the workspace to 10.1.0 to address GHSA-prgh-xp8r-p3m5, GHSA-v53p-9fqp-m79j, GHSA-g57g-f23g-4646, GHSA-8vvx-rff5-p5rq, and GHSA-6vj9-mwq6-2f5v. Preserve the transport-agnostic root, explicit SMTP configuration, receipt mapping, and caller-owned versus factory-owned lifecycle.

Migration: Node SMTP consumers upgrading from @fluojs/email 3.0.3 must replace Nodemailer 9.x with `nodemailer@^10.0.9` and regenerate their lockfile. Nodemailer 10 requires Node.js 20 or newer and bundles its declarations; `@types/nodemailer` remains an optional peer. The Fluo wrapper and factory APIs do not change. Existing caller-owned transporters must use the supported peer. Consumers using only the transport-agnostic root do not need Nodemailer.

TypeScript Node consumers must provide `@types/node` and explicitly include `"types": ["node"]` when ambient type inclusion is disabled, including TypeScript 6, without disabling strict declaration checks.
