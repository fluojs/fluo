---
"@fluojs/cli": patch
---

Fix existing published-mode starters to use each internal package's release
manifest version instead of stale shared dependency ranges. Correct the CLI's
build-time metadata so standalone installations preserve independent package
versions, including React's 0.x range, while local tarball overrides keep priority.
This patch combines with the pending coordinated major release.
