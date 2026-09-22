# Official package documentation verification

This delivery completes the explanatory package-guide scope requested for
stages 4-6. It does not integrate the Book or a separate reference corpus.
The handoff is a pull request, not a public deployment.

## Delivered

- 43 public packages have canonical, source-linked explanatory guides.
- Standard decorators, standalone applications and package composition have
  substantial chapters with executable examples.
- The beginner path remains connected, English-only and blue.
- Source package versions appear on guide pages without claiming publication.
- Coverage/evidence checks, PR impact reporting, a standalone artifact and a
  clean-checkout publication smoke gate are connected to CI.
- Korean repository and Book sources are preserved.

## Captured evidence

- Latest baseline integrated: `5ff686131` (including release and duplicate-copy fixes).
- Public-package build and full repository typecheck passed.
- Documentation fixtures: 61 files, 298 tests passed.
- Complete tooling run: 177 files, 3,220 tests passed before the final focused
  entrypoint/CI additions; those additions passed their targeted checks.
- CI workflow contract suite: 20 tests passed.
- `pnpm verify:docs`: 103 English pages, 43 package guides, the existing knowledge
  index, 72 bilingual Book chapters, documentation types and production build passed.
- Standalone artifact: 103 routes and 1,765 internal links/anchors passed.
  Legacy redirects, query preservation and English search passed.
- Chrome 152: 94 desktop/mobile captures covering every package guide and the
  concept/composition hub; no missing headings, document overflow or page errors.
- Mobile navigation, search selection, empty results and dismissal were exercised.
  Code copy matched all 118 characters of the tested command, horizontal code
  scrolling remained container-local, and dark mode was exercised.
- Independent editorial review covered all 43 guides. Two visual reviewers
  examined the capture matrix and representative images; neither reported a
  blocking visual defect. Static images do not prove every interaction.

Screenshots and machine results are retained locally under
`.omo/evidence/package-guides/`; generated images are not committed.
Per-package execution limits remain in the fixture evidence records.

## Known pre-existing runtime limitations

The guides disclose, rather than silently redefine, the observed Workers
request-binding propagation discrepancy, WebSocket lifecycle-token visibility,
Croner's started named-task replacement issue, and an idle queue shutdown
rejection. No runtime-package behavior was changed in this documentation PR.
Native tests are distinguished from recording transports and structural clients.

## Checks and publication

Use `MAINTENANCE.md` for the exact commands and ownership model.
The repository lint command passes; existing warnings outside this documentation
increment remain. Newly introduced documentation-fixture warnings were fixed.
YAML LSP is unavailable locally; YAML parsing and workflow contract tests were used.

The standalone artifact manifest records the actual source commit, package
versions and dirty flag. Only a clean, passing artifact is eligible for promotion.
Public deployment and PR merging are not performed by this task.
