# Platform Conformance Authoring Checklist

<p>
  <strong>English</strong> | <a href="./platform-conformance-authoring-checklist.ko.md">한국어</a>
</p>

This checklist defines the technical and behavioral requirements for official platform-facing packages in the Konekti ecosystem. It ensures that every package participating in the Konekti platform shell remains predictable, portable, and consistent with the framework's core standards.

## When this document matters

- **Component Creation**: When authoring a new `@konekti/platform-*` or `@konekti/*-adapter` package.
- **Contract Modification**: When updating the public-facing behaviors or lifecycle hooks of a platform-level component.
- **Portability Audits**: When certifying a package's alignment with the Konekti Platform Conformance standard for cross-runtime support (Node.js, Bun, Deno, etc.).

---

## Authoring Checklist

### 1. Conformance Harness & Testing
Every platform-facing package MUST be validated using the framework's official testing harnesses from `@konekti/testing`.
- [ ] **Harness Adoption**: Implements `createPlatformConformanceHarness(...)` for general lifecycle verification.
- [ ] **Transport Portability**: (For HTTP/Message adapters) Uses `createHttpAdapterPortabilityHarness(...)` to verify cross-runtime behavior.
- [ ] **State Isolation**: Verifies that the `validate()` method is a side-effect-free check and does not transition the component state.
- [ ] **Lifecycle Integrity**: Ensures `start()` is deterministic and `stop()` is idempotent (callable multiple times without error).
- [ ] **Degraded Observability**: Confirms that `snapshot()` is callable even when the component is in a failed or degraded state.

### 2. Implementation & Design
- [ ] **Explicit Config**: Exposes a clear, typed configuration interface and validates inputs during the bootstrap phase.
- [ ] **Health vs. Readiness**: Explicitly defines the difference between "Healthy" (process is up) and "Ready" (component is fully operational).
- [ ] **Structured Diagnostics**: Emits stable error codes with actionable `fixHint` metadata for common failure scenarios.
- [ ] **Sanitization**: Ensures that any exported logs or snapshots are sanitized (no API keys, passwords, or credentials).
- [ ] **Resource Ownership**: Clearly declares which resources (e.g., sockets, file handles, DB connections) it owns and ensures they are closed during the `stop()` phase.

### 3. Pull Request Requirements
PRs affecting platform packages MUST provide evidence of compliance:
- [ ] **Harness Evidence**: Link to the test file where the conformance harness is executed.
- [ ] **Contract Shift**: Explicitly call out any changes to documented runtime invariants or behavioral contracts.
- [ ] **Documentation Sync**: Update the package-level `README.md` and the Korean mirror with the latest contract details.

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Architecture Overview](../concepts/architecture-overview.md)
- [Testing Guide](./testing-guide.md)
- [Third-Party Extension Contract](./third-party-extension-contract.md)
