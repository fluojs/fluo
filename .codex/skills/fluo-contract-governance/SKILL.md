---
name: fluo-contract-governance
description: fluo behavioral contract governance knowledge pack. Captures behavioral contract precedence, package README/docs/test/change impact, and release-impact changesets awareness.
compatibility: opencode
metadata:
  language: en
  domain: governance
  mode: knowledge
---

# Fluo Contract Governance

This skill provides the knowledge required to maintain and verify fluo behavioral contracts. Behavioral contracts ensure that packages behave exactly as expected across different runtimes.

## Core Principles

1. **Standard-First**: Prioritize TC39 standard decorators and modern TypeScript features over legacy or experimental behaviors.
2. **Explicitness**: Dependency injection and architectural patterns must be clear and auditable.
3. **Behavioral Consistency**: A package must behave identically across all supported runtimes (Node.js, Bun, Deno, Workers).

## Reference Documents

- `docs/contracts/behavioral-contract-policy.md`: The primary guide for behavioral contract judgment.
- `docs/contracts/testing-guide.md`: Requirements for regression coverage and contract verification.
- `docs/contracts/public-export-tsdoc-baseline.md`: Standards for public API documentation.
- `docs/contracts/platform-conformance-authoring-checklist.md`: Checklist for runtime-agnostic package development.

## Change Impact Checklist

When modifying code, evaluate impact against:

- **Package README**: Does the change align with the documented support and features?
- **Public API Surface**: Does it alter the contract for external consumers?
- **Test Contract**: Are there existing tests that define the contract? Does the change break them?
- **Release Impact**: Does this change require a changeset?
  - `breaking`: Breaking change.
  - `minor`: New feature or significant enhancement.
  - `patch`: Bug fix or minor improvement.

## Contract Guardrails

- **Intentional Limitations**: Do not "fix" documented limitations without a contract update.
- **Contract-Preserving Fixes**: Always prefer solutions that maintain the existing contract over those that require breaking changes.
- **Surface Awareness**: Changes to code often require updates to `README.md`, `docs/`, and `book/`.
