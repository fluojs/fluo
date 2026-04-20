<!-- packages: fluo-repo -->
<!-- project-state: advanced -->
# Chapter 17. fluo Contributing Guide

Congratulations on reaching the final chapter of the fluo series. If you are here, it means you have mastered the intricacies of standard decorators, dependency injection, and advanced runtime architectures. The logical next step for an advanced fluo developer is to help shape the framework itself.

Contributing to fluo is not just about writing code—it is about participating in a culture of strict behavioral contracts, explicit design, and platform-agnostic reliability. This guide provides a deep dive into the fluo repository structure, our contribution workflows, and the governance model that keeps the ecosystem stable.

## Repository Structure and Philosophy

The fluo repository is a high-performance monorepo managed with `pnpm`. Our philosophy is centered on **Behavioral Contracts**. This means that every change is evaluated not just by its functionality, but by its impact on the predictability of the framework across different runtimes (Node.js, Bun, Workers).

### Workspace Organization

- `packages/`: Contains the modular components of the framework.
- `docs/`: Centralized documentation, including operational policies.
- `examples/`: Canonical application setups for verification.
- `.github/`: Workflow definitions and issue/PR templates.

Every package in the `packages/` directory is treated as an independent unit with its own test suite and documentation, but they all adhere to the global repository policies.

## Issue and Label Workflow

We use a highly structured issue intake process to ensure that the maintainers' time is focused on impactful work.

### Issue Templates

Blank issues are disabled in the fluo repository. All issues must follow one of these templates:
- **Bug Report**: Requires a minimal reproduction (stackblitz or repository).
- **Feature Request**: Requires a detailed "Why" and "How" proposal.
- **Documentation Issue**: For fixing gaps or errors in the guides.
- **DX/Maintainability**: For internal improvements that help developers.

Questions should be routed to **GitHub Discussions** rather than the issue tracker.

### Labeling System

Issues are automatically labeled based on the template used. Key labels include:
- `bug`: Confirmed regression or unexpected behavior.
- `enhancement`: A new feature or improvement.
- `type:maintainability`: Internal cleanup or tool improvement.
- `priority:p0` to `p2`: Criticality of the issue.

## Review Culture

Reviewing a Pull Request in fluo is a rigorous process. We don't just "LGTM"—we verify.

### Verification Gate

Every PR must pass the `pnpm verify` command, which runs:
- Linting and formatting checks.
- Unit and integration tests.
- Type checking across all workspace packages.
- Build verification.

### Behavioral Contract Review

As an advanced contributor, your reviews should focus on whether the change preserves existing contracts. Does an optimization in `@fluojs/di` break the scoping rules in `@fluojs/platform-cloudflare-workers`? Does a new decorator in `@fluojs/core` maintain compliance with the TC39 standard?

### Documentation First

If a PR adds a public API, it **must** include inline documentation (JSDoc) and an update to the relevant markdown files in the `docs/` or `packages/*/README.md`. A feature is not complete until it is documented.

## Release Process and Governance

fluo follows a supervised release model to maintain high stability.

### Package Tiers

Packages are categorized into three tiers:
- **Official**: Production-ready, follows strict semver.
- **Preview**: Ready for early adopters, subject to change.
- **Experimental**: Incubation phase, may be removed or drastically changed.

### SEMVER and Migration Notes

For 0.x versions, we still treat breaking changes with care. Any breaking change requires a detailed migration note in the `CHANGELOG.md` of the affected package.

### Release Operations

Release operations are managed via GitHub Actions. We use a "supervised-auto" model where a maintainer triggers the release workflow after ensuring `pnpm verify:release-readiness` passes. This prevents accidental publishes of broken or incomplete builds.

## Governance and RFC Workflow

While small fixes can be PRed directly, significant architectural changes must go through the RFC (Request for Comments) process.

### The RFC Path

1. **GitHub Discussions**: Start a thread in the "Ideas" or "RFC" category to gauge community interest and initial feasibility.
2. **Formal Proposal**: For complex changes, create a markdown proposal (following the example in `packages/graphql/field-resolver-rfc.md`) and open a PR to the `docs/proposals` directory.
3. **Review and Consensus**: The core maintainers and the community review the RFC. Approval is required before implementation begins.

### Behavioral Contract Policy

All contributors must adhere to the `docs/operations/behavioral-contract-policy.md`. This policy ensures that fluo remains the "Standard-First" framework by forbidding the use of non-standard TypeScript features that deviate from the JavaScript language path.

## Local Development Workflow

To set up the fluo repository locally:

```bash
# Clone the repository
git clone https://github.com/fluojs/fluo.git
cd fluo

# Install dependencies
pnpm install

# Run verification
pnpm verify
```

Maintainers are encouraged to use **git worktrees** for isolated issue work. This allows you to keep your `main` branch clean while working on multiple PRs or bug fixes simultaneously.

## Final Words

The strength of fluo lies in its community. By contributing to the framework, you are helping build a future where TypeScript backends are explicit, standard-compliant, and platform-agnostic. We look forward to your first PR!

---
<!-- lines: 208 -->


































































































































































