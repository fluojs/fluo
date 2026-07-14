---
"@fluojs/cache-manager": patch
---

Preserve commit-only cache eviction under pending send

The deferred eviction fallback timer no longer evicts while `response.send(...)` is still pending. Previously, the five-second fallback timer could fire before the response commit completed, contradicting the documented commit-only eviction contract. The fallback timer now evicts only when no response commit path was invoked, so the send path retains ownership of eviction (on success) or cancellation (on failure) while a send is in flight. This prevents a stale write response from invalidating cache before a failed commit becomes visible.