---
"@fluojs/email": patch
---

Make `EmailService.sendNotification(...)` merge transport metadata with `notification.metadata` applied first and `payload.metadata` second, matching the documented payload-overrides-notification-fallbacks contract. A colliding ordinary metadata key now delivers the email-specific payload value to the transport, keys unique to either side remain preserved, and the `notification.template`-derived `template` key is still applied last.

Callers that previously relied on notification metadata winning for colliding ordinary keys now receive the payload value instead; rename one of the colliding keys if both values must reach the transport.
