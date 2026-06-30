---
"@fluojs/microservices": patch
---

Close internally-created MQTT clients when subscription setup fails during startup or when shutdown unwinds a failed in-flight listen attempt.
