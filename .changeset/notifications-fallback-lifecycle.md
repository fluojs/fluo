---
"@fluojs/notifications": patch
---

Fix notification fallback delivery IDs so channel deliveries without external IDs use deterministic request-derived IDs, and publish failed lifecycle events for missing-channel dispatch attempts before throwing configuration errors.
