# English-only blue website

This increment supersedes the website language and color descriptions in the
earlier foundation and stage-3 verification receipts.

## Delivered

- Removed 50 Korean website MDX pages and 11 Korean navigation metadata files.
- Removed website i18n middleware, locale configuration, selector and `[lang]`
  routes. The root opens `/docs`; old `/en`, `/ko`, `/en/docs/...` and
  `/ko/docs/...` URLs permanently redirect to English.
- Canonical website links and search results use `/docs`.
- Applied blue accents derived from the Fluo logo direction: primary `#1d4ed8`
  in light mode and `#80b4ff` in dark mode, with matching borders and surfaces.
- Reorganized navigation around Overview, Fundamentals, Techniques, deployment,
  tools/reference and examples. Overview chapters are directly discoverable.
- Replaced the upcoming-release Node 24 copy with current support
  `>=24.0.0 <27`, removing obsolete package counts and prospective release plans.
- Preserved Korean Books, package READMEs and repository contracts. Only obsolete
  links to deleted website files and website-policy descriptions were updated.

## Evidence

- `pnpm verify:docs`: exit 0; 59 English pages, knowledge-index validation,
  72 bilingual Book chapters, types and production build (63 generated routes).
- Governance migration: 698 impacted tests passed in the delegated track;
  `verify-platform-consistency-governance.mjs` passed in lead verification.
- Final selected Book/source-snippet/learning-path suites: 46 tests passed.
- A new negative regression caught an invalid fallback for deleted relative
  `.ko.mdx` file links. After fixing it, all 12 Book verifier tests and the
  72-chapter Book check passed. Actual URL redirects remain supported; broken
  repository file links are not silently accepted.
- `check-english-site.mjs`: legacy routes returned 308 with query parameters
  preserved; canonical pages returned 200, `lang="en"` and no language selector.
- `check-search.mjs`: ordinary and legacy-locale requests return canonical
  English search URLs.
- All 59 English document routes returned HTTP 200.
- Six desktop/mobile captures under `.omo/evidence/english-blue/` cover
  Introduction, Modules and Node.js support. Width checks were 1440/1440 and
  390/390 (viewport/document), with blue primary computed from the rendered CSS.
- Two independent `bai/glm-5.3-flash` reviews returned PASS without blockers.
  The user cited the logo as evidence of brand color, not a requirement to add
  an image to the existing text wordmark.

No commit or deployment was performed. Earlier learning-path fixtures remain
in place. This change does not claim a complete rewrite of all package guides.
