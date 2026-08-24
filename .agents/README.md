# Fluo OMO+Senpi assets

Project-local OMO entrypoints and knowledge packs live under `.agents/skills/`.
Machine-consumed workflow contracts live under `.agents/workflow-contracts/`.
Runtime state belongs under `.omo/`; skills and memory are not run-state stores.

```json omo-native-assets
{
  "schemaVersion": 1,
  "skills": [
    { "kind": "entrypoint", "name": "create-lane", "path": ".agents/skills/create-lane/SKILL.md" },
    { "kind": "entrypoint", "name": "docs-sync-guardian", "path": ".agents/skills/docs-sync-guardian/SKILL.md" },
    { "kind": "entrypoint", "name": "execute-lane", "path": ".agents/skills/execute-lane/SKILL.md" },
    { "kind": "entrypoint", "name": "issue-to-pr", "path": ".agents/skills/issue-to-pr/SKILL.md" },
    { "kind": "entrypoint", "name": "pr-to-merge", "path": ".agents/skills/pr-to-merge/SKILL.md" },
    { "kind": "entrypoint", "name": "search-issue", "path": ".agents/skills/search-issue/SKILL.md" },
    { "kind": "knowledge", "name": "fluo-contract-governance", "path": ".agents/skills/fluo-contract-governance/SKILL.md" },
    { "kind": "knowledge", "name": "fluo-docs-governance", "path": ".agents/skills/fluo-docs-governance/SKILL.md" },
    { "kind": "knowledge", "name": "fluo-package-audit", "path": ".agents/skills/fluo-package-audit/SKILL.md" },
    { "kind": "knowledge", "name": "fluo-release-operations", "path": ".agents/skills/fluo-release-operations/SKILL.md" }
  ],
  "shippedContractPaths": [
    ".agents/MIGRATION.md",
    ".agents/README.md",
    ".agents/THREAT_MODEL.md",
    ".agents/VALIDATION.md",
    ".agents/skills/docs-sync-guardian/SKILL.md",
    ".agents/skills/docs-sync-guardian/references/guardian.md",
    ".agents/skills/docs-sync-guardian/references/workflow.md",
    ".agents/workflow-contracts/blocker.schema.json",
    ".agents/workflow-contracts/contracts.mjs",
    ".agents/workflow-contracts/event.schema.json",
    ".agents/workflow-contracts/lane-ledger-v2.schema.json",
    ".agents/workflow-contracts/receipt.schema.json",
    ".agents/workflow-contracts/review-verdict.schema.json",
    ".agents/workflow-contracts/schema-validator.mjs",
    ".agents/workflow-contracts/search-artifact-v2.schema.json"
  ]
}
```

Custom `fluo-*` roles are prompt references, not assumed registered
`subagent_type` values. Entrypoint leads read the role reference and pass it in
a self-contained category-routed `task` assignment.
