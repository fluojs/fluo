---
"@fluojs/cache-manager": patch
---

Align the RedisCompatibleClient scan and set contracts with the MATCH/COUNT scan and persistent or EX writes used by RedisStore so real ioredis clients can be registered directly without type assertions. Preserve legacy custom-client compatibility and clarify direct-client support and application lifecycle ownership across the English and Korean guides.
