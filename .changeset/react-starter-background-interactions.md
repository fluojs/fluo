---
"@fluojs/cli": minor
---

Ship the canonical background search/widget and queue-row companion in the React Vite SSR
starter with native GET/POST fallbacks and deterministic real-listener browser fixtures.
Existing apps should adopt the updated catalog and page companion while retaining their
provider, HTTP DTO/auth/CSRF and app-owned persistence/idempotency. Test fault routes are
enabled only by the explicit FLUO_REACT_FORM_TEST_SERVER entry.
