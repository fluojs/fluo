---
"@fluojs/cli": minor
---

Enable same-origin React Fast Refresh and CSS HMR in the generated Node React/Vite starter's canonical `fluo dev` path, including fresh SSR components and WebSocket cleanup. Existing generated projects must adopt the React plugin, dev entry preamble, and application-hosted Vite wiring described in `docs/getting-started/migrate-react-dev-hmr.md`; upgrades do not rewrite application files.
