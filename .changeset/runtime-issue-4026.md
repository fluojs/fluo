---
"@fluojs/runtime": patch
---

Classify malformed Web multipart requests as HTTP 400 `BadRequestException` instead of 500, including a missing boundary parameter, body, closing boundary, valid part header, form-data Content-Disposition header, or name parameter; multipart size-limit failures keep returning HTTP 413. Web request body handling now selects multipart and JSON parsing from the exact, case-insensitive primary media type, so parameter-embedded values such as `text/plain; x=multipart/form-data` are no longer treated as multipart.
