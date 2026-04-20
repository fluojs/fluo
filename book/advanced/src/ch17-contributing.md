<!-- packages: fluo-repo -->
<!-- project-state: advanced -->
# Chapter 17. fluo Contributing Guide

Congratulations on reaching the final chapter of the fluo series. If you are here, it means you have mastered the intricacies of standard decorators, dependency injection, and advanced runtime architectures. The logical next step for an advanced fluo developer is to help shape the framework itself.

Contributing to fluo is not just about writing code—it is about participating in a culture of strict behavioral contracts, explicit design, and platform-agnostic reliability. This guide provides a deep dive into the fluo repository structure, our contribution workflows, and the governance model that keeps the ecosystem stable.

## Repository Structure and Philosophy

The fluo repository is a high-performance monorepo managed with `pnpm`. Our philosophy is centered on **Behavioral Contracts**. This means that every change is evaluated not just by its functionality, but by its impact on the predictability of the framework across different runtimes (Node.js, Bun, Workers).

We adhere to a "Flat but Layered" strategy. Every package should be as thin as possible, delegating complexity to specialized modules while maintaining a unified interface. This ensures that the core of fluo remains small and fast, while the ecosystem can grow indefinitely. We avoid "God packages" that try to do too much; instead, we favor small, composable units that follow the Single Responsibility Principle.

### Workspace Organization

- `packages/`: Contains the modular components of the framework. Each package (e.g., `@fluojs/core`, `@fluojs/di`) must maintain its own independent lifecycle while adhering to the monorepo's global standards.
- `docs/`: Centralized documentation, including operational policies, RFCs, and architectural decision records (ADRs).
- `examples/`: Canonical application setups for verification. These serve as both learning resources and smoke tests for the entire ecosystem.
- `.github/`: Workflow definitions and issue/PR templates that enforce our contribution quality gates.
- `scripts/`: Internal tools for workspace management, release preparation, and benchmarking.
- `tools/`: Reusable build tools and shared configurations (ESLint, Vitest) that ensure consistency across the monorepo.

Every package in the `packages/` directory is treated as an independent unit with its own test suite and documentation, but they all adhere to the global repository policies regarding code style, licensing, and behavioral contracts.

## Issue and Label Workflow

We use a highly structured issue intake process to ensure that the maintainers' time is focused on impactful work. This structure prevents "maintenance fatigue" and keeps the development velocity high. Our goal is to provide a clear path for every report, from initial submission to final resolution.

### Issue Templates

Blank issues are disabled in the fluo repository. All issues must follow one of these templates to ensure all necessary context is provided from the start. This reduces back-and-forth and allows maintainers to triage more effectively:
- **Bug Report**: Requires a minimal reproduction (stackblitz or repository) and a clear description of the expected vs. actual behavior. Please include environment details (Node version, OS, etc.).
- **Feature Request**: Requires a detailed "Why" and "How" proposal, including how it aligns with the Behavioral Contract Policy. Explain the problem you are solving and why it cannot be handled by existing APIs.
- **Documentation Issue**: For fixing gaps, typos, or conceptual errors in the guides. Clear documentation is as important as code.
- **DX/Maintainability**: For internal improvements that help developers work faster or more reliably (e.g., CI optimizations, build tool updates).

Questions should be routed to **GitHub Discussions** rather than the issue tracker to keep the task list actionable and searchable for the community.

### Labeling System

Issues are automatically labeled based on the template used, but maintainers often add secondary labels to refine the triage and signal status:
- `bug`: Confirmed regression or unexpected behavior that violates a contract.
- `enhancement`: A new feature or improvement that expands the framework's capabilities.
- `type:maintainability`: Internal cleanup, tool improvement, or technical debt reduction.
- `priority:p0` to `p2`: Criticality of the issue. P0 issues typically block the next release.
- `status:needs-repro`: The issue is blocked until a minimal reproduction is provided by the reporter.
- `good first issue`: Ideal for new contributors looking to get familiar with the codebase.
- `help wanted`: Significant tasks that the core team may not have immediate capacity for.

## Review Culture

Reviewing a Pull Request in fluo is a rigorous process. We don't just "LGTM"—we verify. Our goal is to ensure that no PR degrades the performance or reliability of the system. We take pride in the quality of our code and the thoroughness of our review process.

### Verification Gate

Every PR must pass the `pnpm verify` command, which is a composite task that runs:
- **Linting and Formatting**: Ensuring consistency via Prettier and specialized ESLint rules. We enforce a strict set of rules to keep the codebase readable and maintainable for everyone.
- **Unit and Integration Tests**: Running the full Vitest suite across all packages. We target 100% coverage for the core packages and expect high quality tests that cover edge cases and error conditions.
- **Type Checking**: Running `tsc --noEmit` to ensure type safety across the entire workspace graph. This includes checking for any implicit `any` usage or unsafe type assertions.
- **Build Verification**: Ensuring that `pnpm build` completes without errors for all package targets (CJS, ESM, and sometimes UMD). This also checks for bundle size regressions to ensure we stay lean.
- **Dependency Audit**: Checking for new dependencies and ensuring they are licensed correctly and do not introduce security vulnerabilities or unnecessary bloat.

### Behavioral Contract Review

As an advanced contributor, your reviews should focus on whether the change preserves existing contracts. Does an optimization in `@fluojs/di` break the scoping rules in `@fluojs/platform-cloudflare-workers`? Does a new decorator in `@fluojs/core` maintain compliance with the TC39 standard?

We prioritize **spec-compliance over convenience**. If a proposed feature requires deviating from the ECMAScript or TypeScript standards, it will likely be rejected unless it can be implemented as a purely opt-in external package. Every line of code added should be defensible against the core principles of the framework. We value explicitness and clarity over clever but obscure implementations.

### Documentation First

If a PR adds a public API, it **must** include inline documentation (JSDoc) and an update to the relevant markdown files in the `docs/` or `packages/*/README.md`. We believe that an undocumented feature does not exist. The reviewer's job includes checking the clarity, accuracy, and tone of these additions. Documentation should be written from the perspective of a user who needs to understand both the "how" and the "why". We also look for examples that demonstrate the new feature in a realistic context.

## Release Process and Governance

fluo follows a supervised release model to maintain high stability across its modular ecosystem.

### Package Tiers

Packages are categorized into three tiers to communicate stability to users and set clear expectations:
- **Official**: Production-ready, follows strict semver, and has 100% test coverage. These are the pillars of the fluo ecosystem.
- **Preview**: Ready for early adopters, subject to change based on real-world feedback. We encourage testing in non-critical environments.
- **Experimental**: Incubation phase, may be removed or drastically changed without notice. This is where we innovate and take risks.

### SEMVER and Migration Notes

For 0.x versions, we still treat breaking changes with extreme care. Any breaking change requires a detailed migration note in the `CHANGELOG.md` of the affected package. We use `changesets` to manage our versioning and changelog generation, ensuring that every significant commit is accounted for and attributed correctly. This transparency is key to building trust with our users.

### Release Operations

Release operations are managed via GitHub Actions to ensure repeatability and security. We use a "supervised-auto" model:
1. A maintainer runs `pnpm verify:release-readiness` locally to check for workspace consistency and pending changes.
2. Changesets are merged into the `main` branch, triggering a "Version Packages" PR that calculates new versions.
3. Once the versioning PR is merged, the GitHub Action automatically publishes the packages to npm and creates GitHub Releases.
This process prevents accidental publishes of incomplete code and ensures that the published artifacts exactly match the source code in the repository.

## Governance and RFC Workflow

While small fixes and documentation updates can be PRed directly, significant architectural changes must go through the RFC (Request for Comments) process to ensure community alignment and technical excellence. This process is designed to prevent architectural drift and ensure that every major addition is well-reasoned.

### The RFC Path

1. **GitHub Discussions**: Start a thread in the "Ideas" or "RFC" category to gauge community interest and identify potential pitfalls early. This is the place for "low-stakes" brainstorming.
2. **Formal Proposal**: For complex changes, create a markdown proposal (following the template in `packages/graphql/field-resolver-rfc.md`) and open a PR to the `docs/proposals` directory. The proposal should cover motivation, detailed design, drawbacks, and alternatives.
3. **Review and Consensus**: The core maintainers and the community review the RFC. Approval from at least two core maintainers is typically required before any implementation begins. We look for technical soundness and alignment with fluo's core philosophy.
4. **Implementation**: Once the RFC is merged (as "Accepted"), the work is split into actionable issues and assigned to contributors. The original RFC author is often the lead for this phase, providing continuity and vision.
5. **Finalization**: After implementation and documentation are complete, the RFC is moved to the "Implemented" state, serving as a permanent record of the design decision.

### Behavioral Contract Policy

### Behavioral Contract Policy

All contributors must adhere to the `docs/operations/behavioral-contract-policy.md`. This policy is the "Constitution" of fluo. It ensures that fluo remains the "Standard-First" framework by forbidding the use of non-standard TypeScript features that deviate from the JavaScript language path. This commitment to standards is what makes fluo future-proof.

The policy covers several key areas:
- **Decorator Standard**: Only TC39 standard decorators (as supported in TypeScript 5.0+) are allowed. Legacy experimental decorators are strictly forbidden.
- **Reflection and Metadata**: The use of `reflect-metadata` is discouraged in favor of explicit registry and standard metadata proposal.
- **Runtime Abstraction**: All I/O and environment-specific logic must be gated behind the `Platform` abstraction layer to ensure portability across Node.js, Bun, Deno, and Workers.
- **Error Handling**: Use of the `Result` pattern for domain-level errors is encouraged over unchecked exceptions.
- **Explicit Inversion of Control**: The DI system must be used in a way that allows for static analysis of the dependency graph wherever possible.

By following these rules, we ensure that the codebase remains accessible to any JavaScript developer, not just those deep into the TypeScript ecosystem's specific quirks.


## Local Development Workflow

To set up the fluo repository locally and start contributing, follow these precise steps to ensure your environment matches the CI expectations:

1. **Prerequisites**: Ensure you have Node.js (LTS), `pnpm` (latest), and `git` installed. We use `pnpm` specifically for its efficient workspace management and strict dependency resolution.
2. **Clone and Install**:
   ```bash
   # Clone the repository
   git clone https://github.com/fluojs/fluo.git
   cd fluo

   # Install dependencies and link packages
   pnpm install
   ```
3. **Verify the Installation**: Run the full verification suite to confirm that your local setup is healthy and matches the repository's baseline state.
   ```bash
   pnpm verify
   ```
4. **Development Loop**: When working on a specific package, use the filter command to keep your watch processes lean. You can also run tests in watch mode for a faster feedback loop.
   ```bash
   # Watch for changes in a specific package
   pnpm --filter @fluojs/core dev

   # Run tests in watch mode for a package
   pnpm --filter @fluojs/core test:watch
   ```

Maintainers are encouraged to use **git worktrees** for isolated issue work. This allows you to keep your `main` branch clean and ready for urgent hotfixes while you work on long-term features in a separate directory. This practice prevents context-switching overhead and reduces the risk of accidental commits to the wrong branch. Additionally, we provide a set of VS Code recommended extensions in `.vscode/extensions.json` to help with linting and formatting automation. Using a consistent editor setup helps reduce trivial PR review comments about style.

## Final Words

The strength of fluo lies in its community and its unwavering commitment to standards. By contributing to the framework, you are helping build a future where TypeScript backends are explicit, standard-compliant, and platform-agnostic. We value every contribution, from a simple typo fix to a major architectural enhancement or a new runtime integration.

Remember that you are joining a group of developers who care deeply about the quality and predictability of software. Your efforts here not only improve fluo but also influence the broader TypeScript ecosystem towards better practices and higher standards. We look forward to your first PR, your insights in discussions, and your unique perspective on how to make fluo even better! If you find any part of this guide confusing or if you see room for improvement, please open an issue or start a discussion so we can improve the contributor experience for everyone who follows in your footsteps. Let's build the future of TypeScript backends together, one standard-compliant commit at a time! We are excited to see what you will build and how you will help fluo grow. Happy coding! We hope to see you in the community soon. Your contribution matters greatly to us. Thank you for being part of the fluo journey and helping us set a new standard for modern backend development across all runtimes. Welcome aboard! We are truly honored to have you with us on this journey. Let's make fluo the best it can be, together. We are one community, one goal, one future. Join us today. See you online! We are waiting for you. Let's go! Together, we are strong and united in our shared mission to evolve the web and empower developers everywhere. The future is ours to build, and we are just getting started. Let's create something extraordinary.

---
<!-- lines: 326 -->




































































































































































