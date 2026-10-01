---
"@fluojs/cli": minor
---

Ship canonical session forms and an application-owned authentication resource
boundary in the React Vite starter. Login/logout/permissions use ordinary HTTP
handlers, explicit `ReactModule.formResult` session outcomes, and the existing
router notification. Add dev/production browser journeys and preserve native
POST/303/GET without JavaScript. Existing apps should adopt the session composition
instead of relying on prefetch-scope changes alone.
