---
"@fluojs/core": minor
"@fluojs/di": minor
"@fluojs/platform-nextjs": minor
---

Add opt-in `defineNextApplication({ key, load })` for sharing one lazy application
Promise across Next server bundles in the same JavaScript global. Initialization
success and failure remain cached; the caller owns shutdown and host restart,
without automatic retries, HMR replacement, or cross-process sharing.

Add `publicToken<T>(namespace)` and `PublicToken<T>` in core, with inferred
`Container.resolve()` results in DI. Tokens retain `Symbol.for` identity and
existing explicit `useExisting`, module visibility, scope, and class-token
contracts. Existing lazy handlers keep their per-closure behavior.
