---
'@fluojs/di': major
---

Extend retryable failed-hook disposal to stale instances retired by `override(...)`. A failed stale `onDestroy()` hook is now retained by the container that scheduled its cleanup instead of being discarded once its error is consumed, so a later explicit `Container.dispose()` invokes that hook again. Error delivery stays separate from retry ownership: a replacement resolution still surfaces the failure exactly once and can continue, only the scheduling container retries the hook so an observing ancestor does not repeat a descendant hook in the same shutdown, and stale hooks that already completed successfully are never repeated.

Consumers whose override-retired cleanup can fail must make those `onDestroy()` hooks safe to attempt again. A shutdown that previously resolved after a failed stale cleanup now rejects with the repeated failure until that hook succeeds.
