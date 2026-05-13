# Platform Conformance Authoring Checklist

<p><strong><kbd>English</kbd></strong> <a href="./platform-conformance-authoring-checklist.ko.md"><kbd>한국어</kbd></a></p>

Use this checklist when authoring or changing official platform-facing packages such as `@fluojs/platform-*`, `@fluojs/*-adapter`, and other runtime adapters that participate in the fluo platform shell.

## Scope

- [ ] MUST: Treat this document as the contract baseline for platform-facing package changes.
- [ ] MUST: Keep package `README.md` files and Korean mirrors aligned when runtime behavior, lifecycle guarantees, or adapter capabilities change.
- [ ] MUST: Keep related behavioral contract docs and tests synchronized with the implementation.

## Conformance Harness Requirements

- [ ] MUST: Run `createPlatformConformanceHarness(...)` from `@fluojs/testing/platform-conformance` for platform component contract checks.
- [ ] MUST: Verify `validate()` does not transition component state.
- [ ] MUST: Verify `validate()` does not introduce long-lived side effects when side-effect capture is configured.
- [ ] MUST: Verify `start()` is deterministic across duplicate calls.
- [ ] MUST: Verify `stop()` is idempotent across duplicate calls.
- [ ] MUST: Verify `snapshot()` stays callable in degraded and failed states.
- [ ] MUST: Verify diagnostics keep stable non-empty `code` values.
- [ ] MUST: Provide `fixHint` for error-severity diagnostics unless the harness configuration explicitly relaxes that requirement.
- [ ] MUST: Verify `snapshot()` output is sanitized. Forbidden key patterns include `secret`, `password`, `token`, `credential`, and `api-key` unless explicitly allowlisted.

## Adapter Portability Requirements

- [ ] MUST: For HTTP adapters, run `createHttpAdapterPortabilityHarness(...)` from `@fluojs/testing/http-adapter-portability`.
- [ ] MUST: Preserve malformed cookie values without crashing or normalizing them away.
- [ ] MUST: Preserve `rawBody` for JSON and text requests when raw-body capture is enabled.
- [ ] MUST: Verify `assertPreservesExactRawBodyBytesForByteSensitivePayloads()` for byte-sensitive payloads so adapters preserve exact `rawBody` bytes without Unicode replacement, newline normalization, or re-encoding.
- [ ] MUST NOT: Preserve `rawBody` for multipart requests.
- [ ] MUST: Support SSE streaming with `text/event-stream` content type and stable event framing.
- [ ] MUST: Report the configured host in startup logs.
- [ ] MUST: Support HTTPS startup and report the HTTPS listen URL.
- [ ] MUST: Remove registered shutdown signal listeners after `close()`.
- [ ] MUST: For fetch-style websocket adapters, run `createFetchStyleWebSocketConformanceHarness(...)` from `@fluojs/testing/fetch-style-websocket-conformance`.
- [ ] MUST: Keep fetch-style websocket capability fields stable: `kind`, `contract`, `mode`, `version`, `support`, and `reason`.

## Package Contract Requirements

- [ ] MUST: Implement the repository policy seam named `PlatformAdapter`; HTTP platform packages satisfy that seam through `HttpApplicationAdapter` from `@fluojs/http`.
- [ ] MUST: Expose typed configuration and validate inputs during bootstrap.
- [ ] MUST: Distinguish health from readiness in package behavior and package docs.
- [ ] MUST: Emit stable diagnostic codes for caller-visible failure states.
- [ ] MUST: Declare owned resources such as sockets, file handles, or connections, and release them during shutdown.
- [ ] MUST NOT: expose credentials, tokens, passwords, or API keys through logs, diagnostics, or snapshots.

## Pull Request Evidence

- [ ] MUST: Link the conformance or portability test file in the pull request description.
- [ ] MUST: Call out documented contract shifts for lifecycle ordering, readiness behavior, shutdown behavior, diagnostics, or adapter capabilities.
- [ ] MUST: Update package `README.md` files and Korean mirrors when the public runtime contract changes.
- [ ] MUST: Keep governed contract docs in English and Korean heading parity when this document pair changes.

## Related Docs

- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Platform Consistency Design](../architecture/platform-consistency-design.md)
- [Testing Guide](./testing-guide.md)
- [Public Export TSDoc Baseline](./public-export-tsdoc-baseline.md)
