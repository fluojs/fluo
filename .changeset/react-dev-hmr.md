---
"@fluojs/cli": minor
"@fluojs/react": patch
---

Enable same-origin React Fast Refresh and CSS HMR in the generated Node React/Vite starter's canonical `fluo dev` path, including fresh SSR components and WebSocket cleanup. Existing generated projects must adopt the React plugin, dev entry preamble, and application-hosted Vite wiring described in `docs/getting-started/migrate-react-dev-hmr.md`; upgrades do not rewrite application files.

Clarify the shipped `@fluojs/react` README's generated starter workflow: compatible React component edits preserve eligible state, CSS edits update in place, and server-only or config edits still restart the development child.
