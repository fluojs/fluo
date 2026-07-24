---
"@fluojs/email": major
---

Require Nodemailer 9.0.1 or newer for the Node SMTP subpath. Upgrade Nodemailer 6, 7, or 8 consumers to `nodemailer@^9.0.1`, refresh the application lockfile, and validate provider-specific SMTP options before adopting this release; the fluo transport factory API is unchanged.
