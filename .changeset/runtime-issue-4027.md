---
"@fluojs/runtime": minor
---

Track runtime cleanup completion per registration on each application or context. Explicit close retries now run only failed registrations in their original order and no longer replay successful registrations, including when the same callback function is registered multiple times.

Consumer note: successful cleanup registrations no longer replay on close retry. No code or configuration changes are required. Lifecycle hook retries remain phase-wide, so lifecycle hooks must still tolerate re-entry.
