---
'@fluojs/studio': major
---

Reject unknown supplied route kinds in static and live Studio artifacts while preserving the legacy `http` default when `kind` is omitted.

Migration: replace every explicit route `kind` value other than `http` or `react-page` before upgrading.
