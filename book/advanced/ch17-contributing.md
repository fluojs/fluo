<!-- packages: fluo-repo -->
<!-- project-state: advanced -->

# Chapter 17. fluo Contributing Guide

This chapter explains the local development environment, verification loop, review culture, and governance flow you should follow when you contribute to the fluo repository. If Chapter 16 showed how to design extension packages, this chapter moves to the next step: proposing that work under the repository rules and contributing it in a maintainable form.

## Learning Objectives
- Understand the fluo repository structure and the work boundaries that matter during contribution.
- Learn how issue templates, the label system, and discussion channels shape collaboration.
- Become familiar with the `pnpm verify` centered verification gate and review expectations.
- See how the Behavioral Contract Policy and the standards first principle affect PR judgment.
- Organize local development setup, worktree usage, and package level development loops.
- Learn how to propose and finish contributions through the RFC and Release governance flow.

## Prerequisites
- Completion of Chapter 16.
- A local development environment with Node.js 18 or later, pnpm, and git installed.
- Basic understanding of monorepo workflows and package level test execution.
- Basic experience reading and fixing verification failures from tests and type checks.

## Repository Structure and Philosophy

The fluo repository is a high performance monorepo managed with `pnpm`. Its core philosophy is **Behavioral Contracts**. Every change is evaluated not only by whether it adds functionality, but also by how it affects framework predictability across different runtimes such as Node.js, Bun, and Workers.

fluo follows a "Flat but Layered" strategy. Every package should stay as thin as possible, delegate complex logic to specialized modules, and keep a unified interface. This keeps the fluo core small and fast while leaving room for the ecosystem to grow. Avoid "God packages" that try to do too much, and prefer small, composable units that follow the Single Responsibility Principle.

### Workspace Organization

- `packages/`: Contains the framework's modular components. Each package, such as `@fluojs/core` or `@fluojs/di`, must keep an independent lifecycle while following the monorepo's global standards.
- `docs/`: Centralized documentation, including operational policies, RFCs, and architectural decision records (ADRs).
- `examples/`: Standard application setups for verification. They act as both learning resources and smoke tests for the whole ecosystem.
- `.github/`: Workflow definitions and issue or PR templates that enforce contribution quality gates.
- `scripts/`: Internal tools for workspace management, release preparation, and benchmarking.
- `tools/`: Reusable build tools and shared configurations, such as ESLint and Vitest, that keep the monorepo consistent.

Every package in the `packages/` directory is treated as an independent unit with its own test suite and documentation, but all of them follow the repository's global policies for code style, licensing, and Behavioral Contracts.

## Issue and Label Workflow

fluo uses a structured issue intake process so maintainers can focus their time on high impact work. This structure reduces maintenance fatigue and keeps development velocity stable. The goal is to give every report a clear path from initial submission to final resolution.

### Issue Templates

Blank issues are disabled in the fluo repository. Every issue must use one of the following templates so the needed context is provided from the start. This reduces unnecessary back and forth and helps maintainers triage more accurately:
- **Bug Report**: Requires a minimal reproduction, such as stackblitz or a repository, plus a clear description of expected behavior and actual behavior. It should also include environment details such as Node version and OS.
- **Feature Request**: Requires a detailed "Why" and "How" proposal, including how it aligns with the Behavioral Contract Policy. Explain the problem being solved and why existing APIs cannot handle it.
- **Documentation Issue**: Used to fix missing guide content, typos, or conceptual errors. Clear documentation matters as much as code.
- **DX/Maintainability**: Used for internal improvements that help developers work faster and more reliably, such as CI optimization or build tool updates.

Questions should be directed to **GitHub Discussions** rather than the issue tracker so the task list stays actionable and searchable for the community.

### Labeling System

Issues are labeled automatically based on the template used, but maintainers often add secondary labels to refine classification and signal status:
- `bug`: A confirmed regression or unexpected behavior that violates a contract.
- `enhancement`: A new feature or improvement that expands framework capability.
- `type:maintainability`: Internal cleanup, tool improvement, or technical debt reduction.
- `priority:p0` through `p2`: Issue severity. P0 issues usually block the next release.
- `status:needs-repro`: Work on the issue is blocked until the reporter provides a minimal reproduction.
- `good first issue`: Suitable for new contributors who want to get familiar with the codebase.
- `help wanted`: Important work that the core team may not have immediate capacity to handle.

## Review Culture

Pull Request review in fluo is a strict verification process. Reviewers do not just leave "LGTM". They check that the change does not lower system performance or reliability.

### Verification Gate

Every PR must pass the `pnpm verify` command, which runs a composite set of tasks:
- **Linting and Formatting**: Checks consistency through Prettier and specialized ESLint rules. A strict rule set keeps the codebase readable and maintainable.
- **Unit and Integration Tests**: Runs the full Vitest suite across all packages. Core packages target 100% coverage, and high quality tests are expected to cover edge cases.
- **Type Checking**: Runs `tsc --noEmit` to verify type safety across the entire workspace graph. This also includes checks for implicit `any` usage and unsafe type assertions.
- **Build Verification**: Confirms that `pnpm build` completes without errors for every package target, such as CJS, ESM, and sometimes UMD. It also checks for bundle size regressions.
- **Dependency Audit**: Checks new dependencies, confirms licenses are correct, and verifies that they do not introduce security vulnerabilities.

### Behavioral Contract Review

Reviews by advanced contributors should focus on whether a change preserves existing contracts. Check that an optimization in `@fluojs/di` does not break scoping rules in `@fluojs/platform-cloudflare-workers`, and that a new decorator in `@fluojs/core` complies with the TC39 standard.

fluo prioritizes **spec-compliance over convenience**. If a proposed feature requires deviation from ECMAScript or TypeScript standards, it will likely be rejected unless it can be implemented as a purely optional external package. Every added line of code should be explainable through the framework's core principles. Explicitness and clarity matter more than clever but obscure implementation.

### Documentation First

If a PR adds a public API, it **must** include inline documentation (JSDoc) and related markdown updates in `docs/` or `packages/*/README.md`. An undocumented feature effectively does not exist. Reviewers also check the clarity, accuracy, and tone of added documentation. Documentation should be written from the perspective of users who need to understand both the "how" and the "why", and it should include examples that show the new feature in a realistic context.

## Release Process and Governance

fluo follows a supervised release model to maintain high stability across the modular ecosystem.

### Package Tiers

Packages are classified into three tiers to communicate stability to users and set clear expectations:
- **Official**: Production ready, follows strict semver, and has 100% test coverage. These are baseline packages in the fluo ecosystem.
- **Preview**: Ready for early adopters and may change based on real feedback. Testing in non-critical environments is recommended.
- **Experimental**: In incubation and may be removed or changed heavily without notice. This is the space for validating new designs.

### SEMVER and Migration Notes

Even in 0.x versions, breaking changes are handled carefully. Every breaking change must include detailed migration notes in the affected package's `CHANGELOG.md`. fluo uses `changesets` to manage versioning and changelog generation so important commits and contributors are reflected accurately. This transparency is central to maintaining user trust.

### Release Operations

Release operations are managed through GitHub Actions for repeatability and security. fluo uses a "supervised-auto" model:
1. A maintainer runs `pnpm verify:release-readiness` locally to check workspace consistency and pending changes.
2. When a changeset is merged into the `main` branch, it triggers a "Version Packages" PR that calculates new versions.
3. After the versioning PR is merged, a GitHub Action automatically publishes packages to npm and creates a GitHub Release.
This process prevents incomplete code from being published by accident and ensures that published artifacts exactly match the repository source code.

## Governance and RFC Workflow

Small fixes or documentation updates can be submitted directly as PRs, but significant architectural changes must go through the RFC (Request for Comments) process to confirm community consensus and technical validity. This process is designed to prevent architectural drift and make sure every major addition has enough justification.

### The RFC Path

1. **GitHub Discussions**: Start a thread in the "Ideas" or "RFC" category to check community interest and find potential pitfalls early. This is a low pressure place for brainstorming.
2. **Formal Proposal**: For complex changes, write a markdown proposal, using the template in `packages/graphql/field-resolver-rfc.md`, and open a PR to the `docs/proposals` directory. The proposal should cover motivation, detailed design, drawbacks, and alternatives.
3. **Review and Consensus**: Core maintainers and the community review the RFC. At least two core maintainer approvals are required before implementation begins. The review checks technical soundness and fit with fluo's core philosophy.
4. **Implementation**: After the RFC is merged as "Accepted", the work is split into actionable issues and assigned to contributors. The original RFC author often leads this stage to provide continuity and direction.
5. **Finalization**: After implementation and documentation are complete, the RFC moves to "Implemented" status and remains as a permanent record of the design decision.

### Behavioral Contract Policy

Every contributor must follow `docs/contracts/behavioral-contract-policy.md`. This policy is close to fluo's constitution. It keeps fluo a standards first framework by forbidding non-standard TypeScript features that diverge from the JavaScript language path. This commitment to standards supports fluo's long term compatibility.

The policy covers several key areas:
- **Decorator Standard**: Only TC39 standard decorators, supported in TypeScript 5.0 and later, are allowed. Legacy experimental decorators are strictly forbidden.
- **Reflection and Metadata**: Use of `reflect-metadata` is discouraged. Explicit registries and standard metadata proposals are preferred.
- **Runtime Abstraction**: All I/O and environment specific logic must sit behind the `Platform` abstraction layer to guarantee portability across Node.js, Bun, Deno, and Workers.
- **Error Handling**: The `Result` pattern is encouraged for domain level errors rather than unchecked exceptions.
- **Explicit Inversion of Control (IoC)**: The DI system should be used in a way that allows static analysis of the dependency graph whenever possible.

Following these rules keeps the codebase accessible to JavaScript developers instead of tying it only to specific habits in the TypeScript ecosystem.

fluo also strictly maintains the "Public Export Baseline". Every function, class, and interface exported from a package must have complete TSDoc comments. This includes `@param`, `@returns`, and at least one `@example` block. This baseline ensures documentation is not limited to markdown guides like this one, but is also readable directly inside the IDE when developers use the framework. This level of detail is necessary for a professional framework and helps lower the learning curve for new contributors and users.

Beyond the standards first approach, fluo enforces a "Minimal Dependency" policy. Every new dependency added to a package must be justified in the PR, and should be a zero dependency or low dependency module whenever possible. This keeps the supply chain safe and bundle sizes predictable. When possible, prefer native Node.js and Web APIs over specialized libraries to reinforce long term maintainability and platform portability goals.

fluo also encourages "Isomorphic Testing" to improve code quality. This means verifying that the same business logic behaves consistently not only in Node.js environments, but also in browser environments. Tools such as Vitest can run virtual environment checks, which helps confirm that fluo behaves consistently across runtimes such as Cloudflare Workers and Bun.

It is helpful for PR descriptions to explain how these policies were applied. Reviewers check not only the technical implementation, but also the philosophical consistency behind it. Code should not be added to fluo without a reason, and every decision should point toward the core values of standards, performance, and explicitness.

Every Friday, the core team and contributors set aside time for "Maintenance Friday". This session focuses on the following items instead of new feature development:
- **Dependency Upgrades**: Keep the workspace current with the latest security patches and library versions.
- **Refactoring**: Improve code clarity and reduce complexity in older modules.
- **Test Suite Expansion**: Increase coverage and add regression tests for recently fixed bugs.
- **CI/CD Optimization**: Improve build and verification pipelines for faster feedback loops.

This dedicated time is necessary to prevent technical debt from accumulating and to keep the fluo ecosystem agile and high performance. Maintenance contributions are treated as just as important as feature contributions.

## Local Development Workflow

To set up the fluo repository locally and start contributing, follow these steps so your local environment matches CI expectations:

1. **Prerequisites**: Make sure Node.js (LTS), `pnpm` (latest), and `git` are installed. fluo uses `pnpm` for efficient workspace management and strict dependency resolution.
2. **Clone and Install**:
```bash
# Clone the repository
git clone https://github.com/fluojs/fluo.git
cd fluo

# Install dependencies
pnpm install
```
3. **Verify the Installation**: Run the full verification suite to confirm that your local setup is healthy and matches the repository baseline.
```bash
# Run verification
pnpm verify
```
4. **Development Loop**: When working on a specific package, use filter commands to keep watch processes light. You can also run tests in watch mode for a fast feedback loop.
```bash
pnpm --filter @fluojs/core dev

pnpm --filter @fluojs/core test:watch
```

Maintainers are encouraged to use **git worktrees** for isolated issue work. This keeps the `main` branch clean and ready for urgent hotfixes while long running feature work happens in a separate directory. The practice reduces context switching cost and lowers the risk of accidentally committing to the wrong branch. The repository also provides a recommended VS Code extension set in `.vscode/extensions.json` to help with linting and formatting automation. Consistent editor settings reduce style related PR review comments.

## Final Words

fluo's strength lies in its community and consistent commitment to standards. Contributing to the framework means helping TypeScript backends move in a more explicit, standards compliant, and less platform bound direction. Every contribution, from a simple typo fix to a major architectural improvement or new runtime integration, is handled under the same verification standard, and whether it is your first PR or a discussion comment, what matters is clearly recording the reason for the change and the verification results. If any part of this guide is confusing, open an issue so the contributor experience can improve. Contributors join a group of developers who take software quality and predictability seriously, so even a small fix improves long term repository stability when it has clear evidence and verification behind it.

A healthy contribution culture starts with respectful communication and durable records. Constructive criticism is welcome, but language that becomes a personal attack is not allowed, and a safe, inclusive environment enables better technical judgment. If something in the review process is unclear or you have a different opinion, explain it with evidence, and keep comments focused on design and evidence rather than people. Code can change or disappear, but intent and design decisions become important assets for later contributors when they are recorded in documentation, so every major contribution should include documentation updates that explain its background. If contribution work requires documentation, follow `docs/style-guide.md`, and before starting, also check `docs/CONTRIBUTING_GUIDELINES_EXTENDED.md`, `CONTRIBUTING.md`, the security policy, and the license policy. These guides cover code style, commit messages, branch strategy, Pull Request templates, clear runnable examples, and the meaning of the MIT license, which reduces reviewer burden and helps changes move faster.

Before proposing work, study the project's current direction and verification tools. The `docs/roadmap/` directory shows where fluo is going and which areas need help, and reading it first makes it easier to judge whether the change you want to propose fits the current direction. To understand framework internals more deeply, use the "Deep Dive" technical blog series and the separate "Advanced Learning Path". They cover topics such as Dependency Injection engine implementation, decorator metadata processing, compiler plugin authoring, and custom DI Scope design, which helps you predict the impact of core-adjacent changes more accurately. If you propose a performance optimization, prove its real effect with data from the "Benchmark Suite" in `scripts/bench/`, and when adding a feature, write tests that define its specification first from a Test-Driven Development perspective. If you discover a serious security vulnerability, do not report it as a public issue. Email `security@fluo.js` directly, where reported vulnerabilities are analyzed and fixed quickly and reporter credit is officially recognized.

fluo also keeps several participation paths open inside and outside the repository. The monthly "fluo Tech Talk" discusses recent architectural changes and performance optimization techniques in depth, and contributors can participate as speakers to share their work from the perspectives of design and verification. Quarterly online "Contributor Day" events let contributors around the world collaborate in real time, share new ideas, and solve complex bugs together in a hackathon format. To participate, subscribe to the newsletter or join the official Slack channel. If it is hard to know where to start, look for issues with the `mentor-needed` label and use the mentoring program for guided first contribution support. Local meetups and study groups are also welcome, and the core team can explain support such as logo usage permission, speaker support, and promotion. Community adapters, plugins, and starter templates help the ecosystem grow beyond the core framework, and strong examples can be introduced through the official documentation's "Ecosystem" section or official social media channels.

Operationally, contributors should share the same baseline. The dedicated development container setup, `devcontainer.json`, helps Docker users start without complex local setup, and a consistent development environment reduces bugs caused by environment differences. "Maintenance Friday" focuses on dependency upgrades, refactoring, test suite expansion, and CI/CD optimization so technical debt does not accumulate, while the quarterly "Transparency Report" shares the number of security vulnerabilities handled during the quarter, summaries of major architectural decisions, and the approval status of RFCs proposed by contributors. The "Enterprise Support" contribution channel gives companies using fluo a path to reflect complex real business requirements back into the framework, and enterprise feedback helps confirm framework boundary conditions and operational needs. Every contribution is recorded and becomes part of release notes and changelogs. At the end of each year, fluo also selects outstanding contributors and runs a thank you event with special ecosystem merchandise, but the core of contribution is shared responsibility for repository quality rather than reward.

Another value gained through contribution is learning how to collaborate. For many people's ideas to become part of one framework, the process needs clear proposals, verifiable evidence, and calm consensus, and resolving disagreements through design and data builds engineering judgment. fluo is an open source project and also a network of engineers pursuing technical excellence, so the important habit is splitting impactful changes into small pieces and discussing them through verifiable evidence. Every line of code and every sentence remains in fluo's change history, so even small fixes should be written responsibly, and it is enough to start with a first issue whose scope is clear. When people work together, fluo becomes a more stable framework. Participation can take many forms, including code, documentation, tests, issue reproductions, discussion, performance measurement, and local community work. Before opening a Pull Request, check related tests and documentation updates, then record the change purpose, preserved contracts, and verification results in the PR description. A good contribution is judged not by flashy scale, but by clear purpose, respectful collaboration, and reproducible verification.
