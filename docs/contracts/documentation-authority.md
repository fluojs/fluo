# Documentation Authority

<p><strong><kbd>English</kbd></strong> <a href="./documentation-authority.ko.md"><kbd>한국어</kbd></a></p>

Docs is the normative framework contract layer for AI writing and reviewing Fluo code. Books is the primary human learning path, explaining those same contracts through product requirements, implementation, and failure scenarios. Distinguish where a reader starts from the document that owns a framework fact.

## Scope and ownership

This policy defines authority and authoring format across repository Docs, delegated package READMEs, Books, the website, and their summaries. It does not introduce runtime guarantees or change public APIs. Apply the existing [Behavioral Contract Rules](./behavioral-contract-policy.md) alongside it.

| Surface | Owned responsibility | Boundary |
| --- | --- | --- |
| `docs/contracts/`, `docs/architecture/`, and related Docs task guides | Shared framework contracts, architecture promises, and scoped execution recipes | Do not combine unrelated contracts or add guarantees without actual evidence. |
| `packages/*/README.md` and Korean companions | Package-specific public APIs and limitations delegated within the Docs layer | Keep installation, exact public imports, essential usage, defaults, and guarantee summaries, and link shared contracts. Do not replace essential content with links alone or duplicate API bodies into `docs/`. |
| `docs/CONTEXT.md` and its Korean companion, the Docs hub | Navigation to owners for AI tasks | Routing and summaries are not independent contract sources. |
| Books and `book/series.json` | Human product narrative and the 24/28/20-chapter curriculum | Derive framework facts from owning Docs contracts. Do not promote product policies or teaching counterexamples into framework guarantees. |
| Website, root README, and other summaries | Contract explanations and discovery | Do not maintain independent API authorities or duplicate support matrices. |
| Implementation, tests, and executable examples | Evidence for comparing and verifying existing contracts | A differing implementation or passing test alone does not override an existing promise. |

Assign one EN/KO owner document pair to each distinct contract. A document may own several contracts, but other surfaces explain and link to that owner. Contracts, stable links, headings/anchors, machine sentinels, and checker dependencies in documents not yet migrated remain valid. Introducing this policy does not declare a complete migration or semantic verification of all 43 packages and 72 chapters.

## AI reading route

1. Read [CONTEXT](../CONTEXT.md) for project constraints and task scope.
2. Use the [contract reference index](../knowledge-index.json) to follow a contract ID's `owner.en`/`owner.ko` and `sourcePaths`/`testPaths`. For contracts not yet indexed, use the [Docs hub ownership table](../README.md#source-ownership) and [package chooser](../reference/package-chooser.md) to find the owning Docs or delegated package README. AI does not need to read the Book first to establish framework facts.
3. Read the owner's scope, defaults, failures, and ownership, following related contracts where needed.
4. Compare the claims with linked implementation, tests, and executable examples, and record the actual verification scope. Do not describe current-checkout verification as verification of the latest published packages.

This is a small pilot reference index connecting documentation authority, bootstrap, and lifecycle documents with evidence paths. It neither duplicates contract text nor declares full 43-package coverage. An index entry or passing `pnpm docs:knowledge-check` does not prove semantic/behavioral correctness; continue comparing owning contracts with execution evidence.

People may start in the Book, but must reach the same owning contracts and execution evidence.

## Markdown contract fields

Use concise Markdown rather than a separate AI-only copy. Expose the following fields in tables or short sections, enriching existing documents without changing stable headings/anchors. Mark irrelevant fields as not applicable with a reason. Do not infer unknown values as defaults or guarantees.

| Field | Required content |
| --- | --- |
| Scope | The task answered, contract owner, applicable runtime/platform/version, and exclusions. |
| Prerequisites | Required packages, prior registration, configuration, files, external services, and execution environment. Distinguish `generated-app` from `repository-example`, and registry from workspace assumptions. |
| Public imports | Actual public package/subpath and export names. Do not present internal source paths as consumer imports. |
| Inputs | Required and optional inputs, accepted values, validation responsibility, and the boundary that rejects invalid input. |
| Defaults | Exact values and behavior when inputs are omitted, including opt-in/opt-out conditions. |
| Outputs | Return values and responses, completion point, observable state, and side effects. |
| Order | Startup, request, error-handling, and shutdown order, including asynchronous completion boundaries. Do not equate creation, readiness, and request admission. |
| Failures | Conditions, throw/reject/response behavior, partial failure, cleanup, retry eligibility, and state after failure. |
| Resource ownership | The framework/adapter/host/application responsible for creation, registration, activation, drain, close/disposal, and signals. |
| Limitations | Guarantees intentionally not provided, unsupported combinations, and policies the application must implement separately. |
| Examples and alternatives | Complete runnable examples or explicitly scoped fragments, expected results, alternative selection criteria, related contracts, and applying Book chapters. |
| Evidence | Paths to actual implementation, public exports, tests, and executable examples with the relevant behavior. Provide verification commands and required environment; distinguish unexecuted scope and external dependencies. |

Record execution date, exact checkout/head, changed files, commands, exit codes, actual stdout/observations, and unverified scope in a verification receipt. Structure, link, and code-equality checks do not automatically prove translation meaning or runtime behavior. This authority policy is a documentation policy, not a runtime API; its application evidence is the [Docs hub](../README.md), [Book editorial standards](../../book/EDITORIAL.md), and project-local [docs skill](../../.agents/skills/fluo-docs-governance/SKILL.md) and [contract skill](../../.agents/skills/fluo-contract-governance/SKILL.md).

## Conflicting sources

Compare the existing contract, owning implementation, and tests together to determine whether the discrepancy is a documentation error or an implementation regression. Record missing or irrelevant tests as an evidence gap. Do not silently reduce an existing guarantee, ordering promise, error behavior, or cleanup responsibility to match the implementation.

Resolve conflicts in the owning document before updating Books and summaries. If public behavior must change, obtain approval separately from documentation reorganization and update implementation, tests, contracts, migration guidance, and required Changesets together. State unresolved conflicts in the review handoff rather than describing them as aligned contracts.

## Change sequence and bilingual increments

1. **Establish the Docs contract:** Identify the owner pair and affected contracts and Book chapters, then resolve conflicts with existing promises.
2. **Verify evidence:** Compare implementation and tests and exercise affected execution paths. Keep commands, results, and limitations in a receipt.
3. **Apply to the Korean Book:** Derive the product narrative from verified Docs. Initial authoring reviews all 72 Korean chapters first. Corrections to an existing Book review, finalize, and freeze the entire affected Korean set, including interdependent chapters.
4. **Align English:** Translate the frozen Korean set without omitting chapter/section order, code, commands, results, defaults, limitations, or failure conditions. Do not draft English alongside unfinished Korean text.
5. **Hand off bilingual increments:** Each mergeable increment contains the finalized Korean set and its English companions, without unrelated untranslated drafts. Pass existing bilingual checks and review meaning. Temporary locale incompleteness during Korean authoring is not a merge-time parity exemption.

Review Book impact for every Docs change. Update affected chapters for semantic changes; record why Book edits are unnecessary for editorial-only changes. Do not replace essential Book explanations with links. Distinguish KRW choices, post/order states, app addresses, and persistence/retry policies as application-owned policies. Clearly separate intentionally failing intermediate code and comparison experiments from the final recommended implementation.

When migrating existing machine sentinels, stable links, and checker consumers, align the owner document, triggers, assertions, and negative regressions in the same verified change without reducing detection strength. Use `pnpm book:check:ko` during Korean authoring and `pnpm book:check` for bilingual increments. `pnpm docs:sync-check` checks website counterpart existence and does not replace EN/KO meaning review. Do not add tests that pin natural-language sentences or prompts.
