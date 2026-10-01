---
"@fluojs/react": minor
---

Extend the existing useForm with opt-in background GET/POST, independent latest-wins
operation state, session-owned cancellation and coalesced fresh current-page HTTP approval.
Omitted options preserve navigation POST and busy skipping. Keep native forms and stable
domain ids; validate generated GET data with decodeRead and retain unknown handwritten data.
Cancelled or uncertain POSTs are not rollback and are never automatically replayed.
See docs/getting-started/migrate-react-progressive-forms.md for upgrade guidance.
