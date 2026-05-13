---
name: fluo-docs-governance
description: fluo documentation governance knowledge pack. Captures EN/KO parity, docs hub companion pages, tooling/CI enforcement, and regression evidence expectations.
compatibility: opencode
metadata:
  language: en
  domain: documentation
  mode: knowledge
---

# Fluo Docs Governance

This skill provides the knowledge required to maintain fluo documentation standards, ensuring consistency, parity, and accuracy across all documentation surfaces.

## Documentation Surfaces

1. **Repository Root**: `README.md` and `README.ko.md`.
2. **Documentation Hub**: `docs/` directory containing reference material, architecture, and guides.
3. **The Book**: `book/` directory containing structured learning paths and tutorials.
4. **Package-Level Docs**: `README.md` and `README.ko.md` within each `packages/*` directory.

## Core Rules

1. **EN/KO Parity**: Every documentation change in English must have a corresponding update in Korean (and vice versa).
2. **Canonical Paths**: Use relative links to canonical reference files (e.g., `docs/reference/package-surface.md`).
3. **Context Sensitivity**: Refer to `docs/CONTEXT.md` and `docs/CONTEXT.ko.md` for overall repository structure and navigation.
4. **Tooling Alignment**: Tooling and CLI documentation must align with `docs/reference/toolchain-contract-matrix.md`.

## EN/KO Sync Checklist

- [ ] `docs/*.md` <-> `docs/*.ko.md`
- [ ] `book/**/*.md` <-> `book/**/*.ko.md`
- [ ] `packages/*/README.md` <-> `packages/*/README.ko.md`
- [ ] Links in both versions point to the correctly localized counterpart where available.

## Regression Evidence

Documentation changes that fix misleading information or document new behavioral contracts should be accompanied by evidence:
- Link to the relevant issue/PR.
- Link to the specific file and line number in the source code that the documentation now accurately describes.
- Verification that CI/CD documentation checks pass.
