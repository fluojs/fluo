---
"@fluojs/graphql": patch
---

Update GraphQL Yoga to ^5.24.5 so its direct, executor, schema, and merge dependency paths resolve patched GraphQL Tools utils for GHSA-7mx3-vvmw-hjmv. Refresh application lockfiles when upgrading. Existing GraphQL APIs and Node.js >=24.0.0 <27 support are preserved; no workspace-only overrides or application migration are required.
