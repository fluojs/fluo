---
"@fluojs/http": minor
---

Support managed `AsyncIterable<SseMessage<T> | T>` return values from `@Sse()` handlers, including SSE framing, abort cleanup, backpressure drain handling, and documented stream error behavior without adding an RxJS dependency.
