# book-docs-ssot-audit runbook

## Scope

- This runbook fixes the default audit target set to `book/**/ch*.ko.md`.
- Audit units are Korean book chapter manuscripts only, not hubs, not indexes, and not docs mirrors.
- Navigation evidence may be read from `book/README.md`, `book/beginner/toc.ko.md`, `book/intermediate/toc.ko.md`, and `book/advanced/toc.ko.md` to confirm part boundaries and the default part order.
- English `docs/` is the only authority input for factual checks and example-code checks.
- If the needed English `docs/` authority is missing, the broader workflow must fail closed and prefer `insufficient_ssot` over `no_issues`.

## Exclusions

- `book/README*` is a navigation aid and chooser surface, not a default audit target.
- `book/*/toc*` is a navigation aid and part boundary surface, not a default audit target.
- English book manuscripts are excluded from the audit target set.
- Korean `docs/` files are excluded as authority inputs and must not be used as fallback authority.
- Do not widen scope to style feedback, prose cleanup, translation quality review, issue filing, PR work, or manuscript editing.

## Output Files

- `docs/audits/book-docs-ssot-audit/runbook.md`
- `docs/audits/book-docs-ssot-audit/beginner.md`
- `docs/audits/book-docs-ssot-audit/intermediate.md`
- `docs/audits/book-docs-ssot-audit/advanced.md`
- `docs/audits/book-docs-ssot-audit/summary.md`

## Execution Order

1. `beginner`
2. `intermediate`
3. `advanced`

- Execute parts in the fixed order above.
- Within each part, only `book/**/ch*.ko.md` chapters are eligible audit surfaces.

## Reviewer Output Schema

Reviewer outputs must be normalized findings, not free-form notes.

| field | required | rule |
| --- | --- | --- |
| `severity` | yes | Use the fixed severity value for the finding. |
| `canonical_title` | yes | Use a stable, deduplicable issue title. |
| `chapter` | yes | Identify the audited `book/**/ch*.ko.md` chapter. |
| `book_citation` | yes | Cite the exact `book` file and line range for the claim. |
| `docs_citation` | yes | Cite the exact English `docs/` file and line range that acts as authority. |
| `problem` | yes | State the factual mismatch or incorrect example-code problem in one compact sentence. |
| `rationale` | yes | Explain why the cited docs authority makes the finding valid. |
| `disposition` | yes | Use exactly one of `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`. |

- Required reviewer output keys are exactly `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- `disposition` is restricted to exactly 4 values: `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`.
- A reviewer finding without both `book_citation` and `docs_citation` is incomplete input and must not be treated as adjudication-ready evidence.
- Do not add editorial-only finding fields such as `style`, `tone`, `translation`, or `clarity-only`.

## Adjudicator Output Schema

Adjudicator outputs must use the same canonical field set so downstream reports can compare reviewer findings without remapping.

| field | required | rule |
| --- | --- | --- |
| `severity` | yes | Preserve the accepted severity for the canonical finding. |
| `canonical_title` | yes | Preserve the stable deduplicated title used for grouping reviewer findings. |
| `chapter` | yes | Preserve the audited `book/**/ch*.ko.md` chapter identifier. |
| `book_citation` | yes | Preserve the exact `book` citation used to support the final disposition. |
| `docs_citation` | yes | Preserve the exact English `docs/` citation used to support the final disposition. |
| `problem` | yes | Preserve the normalized statement of the factual or example-code problem. |
| `rationale` | yes | Record the evidence-driven reason for the final disposition. |
| `disposition` | yes | Use exactly one of `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`. |

- Required adjudicator output keys are exactly `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- `disposition` is restricted to exactly 4 values: `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`.
- Findings that arrive without both evidence fields, `book_citation` and `docs_citation`, are incomplete inputs for adjudication and must stay unresolved until the evidence bar is met.
- Downstream part reports may render `chapter` and `disposition` structurally instead of repeating those keys verbatim on every line item, but that rendering must preserve the same normalized semantics for every adjudicated finding.
- Do not add editorial-only finding fields such as `style`, `tone`, `translation`, or `clarity-only`.

## Mapping Rule

- Every batch must freeze its chapter-to-authority mapping before reviewer fan-out begins.
- The mapping input starts from `docs/CONTEXT.md`, using its read-first navigation to choose the narrowest relevant English `docs/` files instead of roaming the whole docs tree.
- When a chapter topic matches a known beginner-wave anchor, prefer the already identified narrow English authority docs first: `docs/getting-started/quick-start.md`, `docs/getting-started/bootstrap-paths.md`, `docs/getting-started/first-feature-path.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/di-and-modules.md`, `docs/architecture/decorators-and-metadata.md`, `docs/architecture/http-runtime.md`, `docs/architecture/error-responses.md`, `docs/architecture/openapi.md`, `docs/architecture/config-and-environments.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, and `docs/reference/package-surface.md`.
- The mapping step must select a small explicit English authority set per chapter, record those file paths in the batch metadata, and pass the same fixed set to all reviewers for that chapter.
- Prefer the narrowest contract-bearing English docs that directly cover the chapter claim or example. Use broader overview files only when a narrower English authority file does not exist.
- Do not treat Korean docs, `README*`, `toc*`, or free-form whole-tree browsing as authority selection methods. They may help navigation only when already allowed elsewhere in this runbook.
- If a chapter needs multiple English authority files, freeze that exact list before review. Reviewers must not add ad hoc authority files during review unless the batch is restarted with a newly recorded mapping.

## Snapshot Policy

- At the start of each part (`beginner`, `intermediate`, `advanced`), record exactly one authoritative SSOT snapshot SHA before any chapter batch runs.
- Capture that snapshot with `git rev-parse HEAD` or an equivalent command that resolves the current repository commit SHA.
- Each part report must include the single recorded snapshot SHA in its metadata and treat it as the only SSOT snapshot for every batch in that part.
- If the mapping needs to change after reviewer fan-out has started, do not silently mix snapshots. Re-run the affected batch against the same recorded part SHA, or restart the part with a newly recorded SHA and fresh mappings.
- The snapshot policy exists to keep documented-contract evidence stable while the part is in flight and to prevent moving-target comparisons across different docs revisions.

## Insufficient SSOT Rule

- Missing English authority is a fail-closed condition. If the mapping step cannot identify a relevant English `docs/` authority file for a chapter claim or example, the resulting disposition must be `insufficient_ssot`.
- Silent English authority is also a fail-closed condition. If the frozen English authority set does not document the claim, behavior, or example strongly enough to support a dual-citation decision, record `insufficient_ssot` rather than inferring `no_issues`.
- `no_issues` is allowed only after reviewers and adjudicator confirm the frozen English authority set exists and is sufficiently explicit for the covered chapter scope.
- Do not downgrade missing authority, silent authority, or ambiguous authority coverage into `false_positive` or `no_issues`.
- Part reports should preserve the mapped authority paths next to every `insufficient_ssot` outcome so later batches can see which English authority lookup failed.

## Reviewer Prompt Pack

Use exactly these 3 reusable reviewer templates for every chapter audit. Keep the role split fixed. Do not add a fourth reviewer. Do not merge the roles.

### 1. contract/prose reviewer template

#### TASK

- Review one mapped `book/**/ch*.ko.md` chapter against its frozen English `docs/` authority set.
- Focus only on factual claims, contract statements, definitions, guarantees, constraints, sequencing claims, and prose assertions that can be checked against English docs authority.
- Ignore example-code correctness unless the surrounding prose makes a factual claim that can be validated without judging the code block itself.

#### SCOPE

- In scope: factual mismatches between Korean chapter prose and mapped English `docs/` authority.
- In scope: contract drift, silent narrowing, overstatement, missing caveat, wrong terminology when the terminology changes the factual meaning.
- Out of scope: code block correctness, command correctness, API syntax validation, style, tone, readability, translation quality, and broad editorial rewriting.

#### MUST DO

- Use only the frozen English `docs/` authority set provided by the mapping step.
- Treat English `docs/` as the only authority source.
- Check claims sentence by sentence where the chapter states behavior, guarantees, limitations, package relationships, or workflow facts.
- Emit findings only with the normalized field set: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Require dual citation for every finding. `book_citation` must point to the Korean chapter lines. `docs_citation` must point to the English docs authority lines.
- If either `book_citation` or `docs_citation` is missing, treat the evidence as incomplete and use `disposition: insufficient_ssot`, not an accepted claim.
- Keep `canonical_title` stable and deduplicable across later reviewer and adjudicator passes.
- Use `problem` for one compact mismatch statement, and use `rationale` for why the cited English docs authority controls the claim.

#### MUST NOT DO

- Do not review code blocks as code examples.
- Do not flag style, tone, translation, clarity-only, readability, or broad editorial rewrite concerns.
- Do not cite Korean `docs/`, `README*`, `toc*`, or unmapped English docs as authority.
- Do not emit free-form notes, summaries, recommendations, or fields outside the normalized schema.
- Do not output a finding as `real_issue` or `false_positive` when either citation is missing.

#### REQUIRED OUTPUTS

- Return only a list of normalized finding objects.
- Every object must use exactly these keys: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Allowed `disposition` values are exactly `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`.
- If no factual prose issue is supported, return a single normalized object with `disposition: no_issues` and the same schema keys.

### 2. example-code reviewer template

#### TASK

- Review one mapped `book/**/ch*.ko.md` chapter against its frozen English `docs/` authority set.
- Focus only on code blocks, shell commands, configuration snippets, API usage examples, imports, package names, and executable example flows that claim to show correct usage.
- Judge whether the example or command matches the mapped English `docs/` authority and whether the example teaches an incorrect API or workflow.

#### SCOPE

- In scope: wrong imports, wrong package names, wrong commands, wrong API signatures, wrong configuration keys, wrong sequencing in example flows, and code snippets that contradict the mapped English docs contract.
- In scope: prose immediately attached to a code block only when that prose changes the code example claim.
- Out of scope: broad prose-only factual review, style, tone, readability, translation quality, and non-code editorial rewrite.

#### MUST DO

- Use only the frozen English `docs/` authority set provided by the mapping step.
- Treat English `docs/` as the only authority source for example validation.
- Review every executable-looking example surface in the chapter, including fenced code blocks, inline commands, and config snippets.
- Emit findings only with the normalized field set: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Require dual citation for every finding. `book_citation` must cite the chapter lines that contain the example or command. `docs_citation` must cite the English docs lines that prove the expected usage.
- If either `book_citation` or `docs_citation` is missing, treat the evidence as incomplete and use `disposition: insufficient_ssot`, not an accepted claim.
- Keep findings tied to concrete code-contract mismatches, not personal preferences or ungrounded cleanup ideas.
- Use `problem` for one compact example-code failure statement, and use `rationale` for why the cited English docs authority makes the example invalid or valid.

#### MUST NOT DO

- Do not drift into broad contract/prose review unless the prose changes the example claim itself.
- Do not flag style, tone, translation, clarity-only, readability, or broad editorial rewrite concerns.
- Do not invent runtime behavior rules that are not stated in the mapped English docs.
- Do not cite Korean `docs/`, `README*`, `toc*`, or unmapped English docs as authority.
- Do not emit free-form notes, summaries, recommendations, or fields outside the normalized schema.
- Do not output a finding as `real_issue` or `false_positive` when either citation is missing.

#### REQUIRED OUTPUTS

- Return only a list of normalized finding objects.
- Every object must use exactly these keys: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Allowed `disposition` values are exactly `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`.
- If no example-code issue is supported, return a single normalized object with `disposition: no_issues` and the same schema keys.

### 3. coverage/edge-case reviewer template

#### TASK

- Review one mapped `book/**/ch*.ko.md` chapter against its frozen English `docs/` authority set.
- Focus only on factual or example-code gaps at the contract boundary, missing caveats, omitted prerequisites, unsupported edge-case claims, and places where the chapter appears complete but the mapped English docs show additional conditions needed to keep the claim correct.
- This role is a coverage and risk review, and it must not duplicate the first two reviewers.

#### SCOPE

- In scope: omitted constraints that change correctness, missing prerequisite steps around examples, edge-case mismatch risks, unsupported default assumptions, absent failure-mode notes, and places where the chapter implies coverage that the mapped English docs narrow or qualify.
- In scope: weak evidence situations where the chapter claim cannot be accepted because the mapped English docs are too silent for a safe decision.
- Out of scope: pure prose copy editing, pure code syntax linting, style, tone, readability, translation quality, and broad editorial rewriting.

#### MUST DO

- Use only the frozen English `docs/` authority set provided by the mapping step.
- Treat English `docs/` as the only authority source.
- Look for missing boundary conditions between prose claims and example-code claims, especially prerequisites, limitations, environment assumptions, and edge cases documented in English docs but absent in the chapter.
- Emit findings only with the normalized field set: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Require dual citation for every finding. `book_citation` must cite the lines where the omission or risky implication appears. `docs_citation` must cite the English docs lines that introduce the missing condition, caveat, or limit.
- If either `book_citation` or `docs_citation` is missing, treat the evidence as incomplete and use `disposition: insufficient_ssot`, not an accepted claim.
- Prefer fail-closed reasoning when the mapped English docs are too silent to prove or clear the chapter claim.
- Use `problem` for one compact coverage-gap or edge-case-risk statement, and use `rationale` for why the cited English docs authority changes the correctness boundary.

#### MUST NOT DO

- Do not re-run the full contract/prose review.
- Do not re-run the full example-code review.
- Do not flag style, tone, translation, clarity-only, readability, or broad editorial rewrite concerns.
- Do not cite Korean `docs/`, `README*`, `toc*`, or unmapped English docs as authority.
- Do not emit free-form notes, summaries, recommendations, or fields outside the normalized schema.
- Do not output a finding as `real_issue` or `false_positive` when either citation is missing.

#### REQUIRED OUTPUTS

- Return only a list of normalized finding objects.
- Every object must use exactly these keys: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Allowed `disposition` values are exactly `real_issue`, `false_positive`, `insufficient_ssot`, `no_issues`.
- If no coverage or edge-case issue is supported, return a single normalized object with `disposition: no_issues` and the same schema keys.


## Adjudicator Template

Use one centralized adjudicator pass per chapter after the 3 reviewer outputs are collected and normalized.

### TASK

- Review the deduplicated reviewer findings for one mapped `book/**/ch*.ko.md` chapter.
- Make final dispositions using evidence completeness and contradiction/code-error reasoning, not reviewer consensus.
- Produce the chapter-ready final finding set that will flow into the part report.

### EXPECTED OUTCOME

- Every reviewed chapter ends with explicit final outputs that can be copied into the part report without remapping.
- Every accepted `real_issue` decision is supported by dual citations plus contradiction or code-error rationale.
- Reviewer overlap is merged into one canonical finding without dropping any supporting citations.

### REQUIRED INPUTS

- The frozen chapter-to-authority mapping for the chapter.
- The 3 reviewer output lists from the fixed reviewer roles.
- The part snapshot SHA already recorded for the active part.

### MUST DO

- Read all reviewer findings for the chapter before assigning any final disposition.
- Use the normalized schema keys only: `severity`, `canonical_title`, `chapter`, `book_citation`, `docs_citation`, `problem`, `rationale`, `disposition`.
- Treat reviewer agreement as a hint only. Agreement alone is never enough to accept a finding.
- Accept `disposition: real_issue` only when all of the following are true:
  1. `book_citation` is present and points to the exact Korean chapter lines.
  2. `docs_citation` is present and points to the exact English `docs/` authority lines.
  3. The rationale explicitly shows either a contradiction between the cited chapter lines and cited docs lines, or a code-error rationale showing the cited example/command/config/API usage is wrong under the cited docs authority.
- If dual citations are present but the contradiction or code-error rationale is not explicit enough, do not accept the claim as `real_issue`.
- Preserve fail-closed behavior. If the mapped English authority is missing, too silent, or too ambiguous to support a final evidence-based decision, use `insufficient_ssot`.
- Carry forward the strongest evidence-backed `severity` for each accepted canonical finding and keep all supporting reviewer citations attached in working notes until the part report is finalized.

### MUST NOT DO

- Do not use majority vote, reviewer count, or reviewer confidence alone to accept `real_issue`.
- Do not accept any finding with missing `book_citation` or missing `docs_citation`.
- Do not convert missing evidence into `false_positive` or `no_issues`.
- Do not create optional or hidden chapter outcomes.
- Do not add schema fields outside the normalized field set in the final chapter findings.

### FINAL DECISION RULES

- `real_issue`: dual citations are present, and the rationale proves a contradiction or concrete code error against the mapped English docs authority.
- `false_positive`: dual citations are present, but the cited book lines do not actually contradict the cited English docs authority, or the claimed code error is disproven by the cited authority.
- `insufficient_ssot`: the mapped English docs authority is missing, too silent, too broad, or too ambiguous to support a safe final decision.
- `no_issues`: after adjudication, no accepted contradiction or code error remains, and the mapped English docs authority is sufficient for the chapter scope.

### REQUIRED OUTPUTS

- Return a chapter-level final finding set using only normalized finding objects.
- Return at least one visible chapter status outcome for every audited chapter: `real_issue`, `false_positive`, `insufficient_ssot`, or `no_issues`.
- Keep `accepted findings`, `false positives`, `insufficient SSOT`, and `no issues` visible in the downstream part report even when one or more sections are empty.

## Duplicate Merge Rule

- Merge overlapping reviewer findings before the final adjudicator disposition is assigned.
- The merged unit is one canonical finding identified by a stable `canonical_title` plus the same chapter path.
- Treat findings as near-duplicates when they describe the same underlying contradiction or the same underlying code error, even if the wording, severity phrasing, or reviewer role differs.
- Merge near-duplicates into one canonical record when all of the following are materially shared:
  1. same `chapter`
  2. same or substantially overlapping `book_citation`
  3. same or substantially overlapping `docs_citation`
  4. same root contradiction or same root code-error theme
- When merged, preserve every supporting citation and reviewer-origin note in adjudication working notes so evidence is not lost.
- The adjudicator output should emit one canonical finding, not parallel duplicates, after the merge is complete.
- If two findings share a topic but rely on different book lines, different docs lines, or different contradiction/code-error rationales, keep them separate canonical findings.
- If one reviewer marks a candidate as `real_issue` and another marks it as `false_positive`, do not split by reviewer count. Merge under one `canonical_title`, compare the citations and rationale directly, and let the final disposition be evidence-driven.

## Part Report Template

Use one part report per part: `beginner`, `intermediate`, `advanced`.

```md
# book-docs-ssot-audit-<part>

## Part Metadata
- Part: `<beginner|intermediate|advanced>`
- Execution order slot: `<1|2|3>`
- SSOT snapshot SHA: `<git-sha>`
- Report path: `docs/audits/book-docs-ssot-audit/<part>.md`
- Chapter inventory: `<comma-separated audited chapter paths>`
- Mapping source note: `Frozen before reviewer fan-out per chapter.`

## Chapter Inventory
- `<chapter-path-1>`
- `<chapter-path-2>`
- `<chapter-path-3>`

## Chapter Reports

### <chapter-path>
- Final chapter status: `<real_issue|false_positive|insufficient_ssot|no_issues|mixed>`
- Mapped English authority: `<docs path list>`
- Snapshot SHA: `<git-sha>`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- None.

#### No Issues
- None.

### <next-chapter-path>
- Final chapter status: `<real_issue|false_positive|insufficient_ssot|no_issues|mixed>`
- Mapped English authority: `<docs path list>`
- Snapshot SHA: `<git-sha>`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- None.

#### No Issues
- None.
```

- `## Part Metadata` is mandatory and must include part name, execution order slot, single part snapshot SHA, report path, and chapter inventory.
- `## Chapter Inventory` is mandatory and must list every audited `book/**/ch*.ko.md` chapter assigned to the part.
- `## Chapter Reports` is mandatory and must include one visible chapter block for every chapter listed in `## Chapter Inventory`.
- Every chapter block must keep all four visible section labels: `Accepted Findings`, `False Positives`, `Insufficient SSOT`, `No Issues`.
- Empty sections must still remain visible with `- None.` so chapter disappearance is impossible and grep-based QA can prove coverage.
- Use `Final chapter status: mixed` only when more than one final bucket is populated for the same chapter. Otherwise use the single matching final status.
- In rendered part reports, the `### <chapter-path>` heading carries the normalized `chapter` value for every finding listed inside that chapter block.
- In rendered part reports, section membership carries the normalized `disposition` value: `Accepted Findings` => `real_issue`, `False Positives` => `false_positive`, `Insufficient SSOT` => `insufficient_ssot`, and `No Issues` => `no_issues` for the visible chapter-level no-finding outcome.

## Chapter Status Template

Use this exact per-chapter template inside every part report so no audited chapter can disappear.

```md
### <chapter-path>
- Final chapter status: `<real_issue|false_positive|insufficient_ssot|no_issues|mixed>`
- Mapped English authority: `<docs path list>`
- Snapshot SHA: `<git-sha>`

#### Accepted Findings
- `<canonical_title>`
  - Chapter: inherited from the surrounding `### <chapter-path>` heading.
  - Disposition: inherited from this `#### Accepted Findings` section as `real_issue`.
  - Severity: `<severity>`
  - Book: `<book file:line>`
  - Docs: `<docs file:line>`
  - Problem: `<one-sentence contradiction or code-error summary>`
  - Rationale: `<why the docs citation proves the contradiction or code error>`

#### False Positives
- `<canonical_title or None.>`
  - Chapter: inherited from the surrounding `### <chapter-path>` heading.
  - Disposition: inherited from this `#### False Positives` section as `false_positive`.
  - Book: `<book file:line>`
  - Docs: `<docs file:line>`
  - Rationale: `<why the cited claim does not hold>`

#### Insufficient SSOT
- `<canonical_title or None.>`
  - Chapter: inherited from the surrounding `### <chapter-path>` heading.
  - Disposition: inherited from this `#### Insufficient SSOT` section as `insufficient_ssot`.
  - Book: `<book file:line or unresolved citation target>`
  - Docs: `<mapped docs path or missing authority note>`
  - Rationale: `<why the authority is too weak or missing>`

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`
  - Chapter: inherited from the surrounding `### <chapter-path>` heading.
  - Disposition: inherited from this `#### No Issues` section as `no_issues`.
```

- `Accepted Findings` may include only adjudicated `real_issue` items.
- `Accepted Findings` entries must include both `Book:` and `Docs:` citations plus rationale that explicitly describes a contradiction or code-error basis.
- `False Positives` records must stay visible so rejected reviewer claims remain auditable.
- `Insufficient SSOT` records must stay visible so unresolved authority gaps remain auditable.
- `No Issues` must stay visible even when another section is populated; use `None.` only where the template already allows it.
- The chapter template is mandatory for every audited chapter in every part report.
- The rendered template keeps `chapter` and `disposition` as required normalized fields by projecting them structurally: the chapter heading supplies `chapter`, and the active section label supplies `disposition`.
- Within this rendered template, `### <chapter-path>` is the explicit carrier for the normalized `chapter` field, and each finding inherits its normalized `disposition` from the section where it is listed.
