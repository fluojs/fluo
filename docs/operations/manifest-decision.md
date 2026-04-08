# Manifest Strategy Decision

<p>
  <strong>English</strong> | <a href="./manifest-decision.ko.md">한국어</a>
</p>

This document defines the framework's stance on compile-time manifest generation for runtime optimization. It serves as the authoritative record for why certain performance-oriented architectural shifts are deferred or adopted.

## When this document matters

- **Performance Auditing**: When evaluating runtime bottlenecks in module registration or DI resolution.
- **Architectural Proposals**: When suggesting changes to how Konekti discovers routes, providers, or metadata.
- **Toolchain Updates**: When modifying the build process (e.g., adding a pre-compilation step for metadata extraction).

---

## Current Strategic Decision

**Status**: `DEFERRED`  
**Latest Review**: 2026-04-08

### Decision Summary
Konekti currently relies on **Runtime Reflection** via standard TC39 decorators. We have explicitly deferred the implementation of a **Compile-Time Manifest** (static metadata extraction) for the following reasons:

1.  **Complexity Overhead**: Introducing a mandatory pre-compilation step would significantly increase the complexity of the developer experience (DX) and the CLI toolchain.
2.  **Performance Thresholds**: Current bootstrap benchmarks show that runtime registration is within acceptable limits (sub-millisecond for most module shapes).
3.  **Standard Alignment**: We prioritize staying as close to the TC39 decorator standard as possible, avoiding "magic" build-time code generation unless strictly necessary.

---

## Benchmarking & Adoption Criteria

Adoption of a manifest-based strategy will only be reconsidered if benchmarks demonstrate a **>20% improvement** in startup time for large-scale applications (100+ modules).

### Benchmark Baseline (2026-03-12)
| Application Shape | Boot Time (Avg) | Metadata Memory |
| :--- | :--- | :--- |
| **Hello World** (1 Module) | 0.35ms | < 1MB |
| **Medium REST** (15 Modules) | 0.48ms | ~2.5MB |
| **Module Heavy** (50 Modules) | 0.47ms | ~4.1MB |

**Run the Benchmark:**
```bash
pnpm exec tsx tooling/benchmarks/manifest-decision.ts
```

---

## Behavioral Parity Requirements

If a manifest strategy is adopted, it MUST maintain 100% parity with the current runtime behavior. Any optimization must be transparent to the user and pass the following gates:

- **Route Discovery**: Metadata-driven route registration must produce identical OpenAPI and internal dispatcher maps.
- **DI Resolution**: The module graph structure, including circular dependency detection, must remain unchanged.
- **Error Consistency**: Diagnostic messages and validation failures must trigger at the same lifecycle stages.

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Architecture Overview](../concepts/architecture-overview.md)
