---
"@fluojs/cron": major
---

Reject blank decorator scheduling task names, normalize distributed Redis client names, and cover cron lifecycle/status regression paths.

Migration notes:

- Replace blank decorator `name` values with stable non-empty names, and move any scheduled static methods behind public instance methods.
- Remove leading or trailing whitespace from `distributed.clientName` and register the Redis client under that trimmed name, or omit `clientName` to keep using the default Redis registration.
