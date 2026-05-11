---
"@fluojs/graphql": patch
---

Restore the temporary GraphQL `instanceOf` monkey patch when application bootstrap fails, preventing failed startups from leaking process-wide GraphQL behavior into later app attempts.
