---
"@fluojs/react": minor
"@fluojs/http": minor
"@fluojs/cli": minor
---

Add one progressive native HTTP form path through `useForm` and the existing
React provider, with `ReactModule.formResult` for confirmed persistence.
Preserve native POST/303/GET, HTTP-owned DTO/auth/CSRF/status/error behavior,
and v2 navigation build identity.

Expose typed independent pending/dirty state, bounded safe field/form rejection,
skipped busy activation, uncertain persistence, and separately typed post-save
read outcomes with GET-only recovery. There is no automatic POST retry or native
POST replay. Existing HTML error configuration and explicit refresh semantics
remain compatible.

Include production CRUD in the official Vite starter and runnable example.
Upgrade the affected React/HTTP/CLI releases together; follow
`docs/getting-started/migrate-react-progressive-forms.md` for native encoding,
safe error projection, destination policies and recovery UI.
