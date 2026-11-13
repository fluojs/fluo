---
'@fluojs/runtime': minor
---

Bound retained platform lifecycle and validation diagnostics to the latest diagnostic per component, phase, and code. Repeated failures now replace earlier message, cause, severity, and fix-hint details instead of accumulating an unbounded event history in snapshots. Distinct keys keep their first-seen order, probe retention remains separate, and public diagnostic payload fields and lifecycle behavior are unchanged.

Snapshots expose the latest diagnostic for each key rather than a complete history of repeated occurrences. No consumer code or configuration changes are required.

Document the diagnostic retention phases and failure helpers with source-level TSDoc.
