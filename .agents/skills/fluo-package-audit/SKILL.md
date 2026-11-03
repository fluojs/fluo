---
name: fluo-package-audit
description: Fluo package audit routing, finding, triage, and label knowledge.
compatibility: omo
---

# Fluo package audit

Use `.agents/skills/search-issue/references/domain.json` as the canonical
package, group, purpose, reviewer, label, and package-area catalog.

Audits must:

- resolve visible intake values to canonical slugs before work starts;
- freeze one immutable package scope;
- dispatch the purpose route's reviewers with typed result contracts;
- deduplicate against open issues;
- send every draft through registration triage;
- register only approved, non-sensitive, high-confidence findings;
- fail closed on catalog drift, unknown labels, missing reviewer output, or
  incomplete publication receipts.

Keep package groups aligned with their `area:<group-slug>` labels. Every
public package also has a `pkg:<package-slug>` label. Drafts and approved
registration decisions retain both labels for each affected package; bundled
issues use the deduplicated union, not all packages in the audit scope.
Confirm required labels exist on GitHub before registration.

Security-sensitive reports, support questions, duplicates, speculative ideas,
and low-confidence P2 findings are deferred or rejected.
