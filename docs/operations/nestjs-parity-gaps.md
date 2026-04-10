# NestJS Parity Gaps

<p>
  <strong>English</strong> | <a href="./nestjs-parity-gaps.ko.md">한국어</a>
</p>

This document tracks functional and architectural differences between fluo and NestJS. It serves as a strategic roadmap for achieving feature parity while maintaining fluo's core philosophy of **standard-based, metadata-free** development.

## When this document matters

- **Migration Planning**: When evaluating the feasibility of porting a NestJS application to fluo.
- **Strategic Development**: When prioritizing new feature development for the core framework.
- **Ecosystem Expansion**: When authoring compatibility layers or third-party adapters.

---

## Active Functional Gaps

We categorize gaps by their impact on production workflows.

### Tier 1: Ecosystem Gaps
- **Stability Maturity**: fluo is currently in the `0.x` stabilization phase. A transition to `1.0` (LTS) is the primary hurdle for large-scale enterprise adoption.
- **Public Showcase**: We lack a public-facing gallery of production users and community-contributed "fluo Awesome" lists.

### Tier 2: Developer Experience (DX)
- **CLI Breadth**: NestJS provides a wide range of schematic generators (e.g., `nest g res`). fluo's CLI is currently focused on `new`, `build`, and `repo` slices.
- **Hybrid Application Ergonomics**: `@fluojs/microservices` already ships the base transport layer and documented adapters (see [package-surface.md](../reference/package-surface.md) and [`packages/microservices/README.md`](../../packages/microservices/README.md)). The remaining gap is NestJS-style hybrid application composition and related DX, not missing gRPC or RabbitMQ support.

---

## Resolved & Philosophical Differences

fluo intentionally diverges from NestJS in certain areas to adhere to TC39 standards.

| Feature | fluo Stance | NestJS Stance |
| :--- | :--- | :--- |
| **Decorators** | Standard TC39 Stage 3. | Legacy Reflection (Experimental). |
| **DI Resolution** | Explicit tokens and classes. | Reflection-based (`reflect-metadata`). |
| **Validation** | Standard-based (Zod, Valibot). | Class-based (`class-validator`). |
| **Standalone Mode** | Native and lightweight. | Secondary bootstrap mode. |

### Recently Resolved Gaps
- **[2026-03] Standalone Application Context**: Shipped in `@fluojs/runtime`.
- **[2026-02] Schema-based Validation**: Support for Standard Schema implemented across HTTP runtimes.
- **[2025-11] Microservice Base & Transport Adapters**: Base transport layer and first-party transport adapters shipped in `@fluojs/microservices`.

---

## Maintenance Policy

1.  **Closing a Gap**: When a gap is resolved, move it to the **Resolved** table and update the package's `README.md`.
2.  **Adding a Gap**: New gaps should be added as **GitHub Issues** first, then mirrored here for long-term tracking.
3.  **Philosophical Splits**: If a NestJS feature is intentionally avoided (e.g., "Experimental Decorators"), it must be documented in the **Philosophical Differences** section.

---

## Related Docs
- [Release Governance](./release-governance.md)
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Migrate from NestJS](../getting-started/migrate-from-nestjs.md)
