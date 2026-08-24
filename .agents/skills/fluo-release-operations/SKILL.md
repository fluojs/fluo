---
name: fluo-release-operations
description: Fluo Changesets and GitHub Actions-only release knowledge.
compatibility: omo
---

# Fluo release operations

Changesets are the sole source of truth for versions and changelogs. Never run
local package publish commands. Stable releases flow through `main`, the
Version Packages PR, and `.github/workflows/release.yml`.

Every public-package change needs an appropriate patch, minor, or major
changeset. Major changes require maintainer approval and consumer-facing
migration notes.

Verify release intent with:

```text
pnpm verify:changeset-release-lane -- --lane=stable --base-ref=<ref>
```

Do not downgrade semver to silence a failing release gate; fix malformed
metadata or generated version data.
