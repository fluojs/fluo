# Documentation maintenance and publication

The official site is English-only, uses `/docs`, and explains public packages
and their composition. It does not import the Book or maintain a second
generated reference corpus. Korean repository contracts, READMEs and Books remain
separate maintained sources.

## Ownership

The package maintainer owns behavior, defaults, errors, supported runtimes and
resource lifecycle. The documentation reviewer owns explanation, examples,
navigation and missing prerequisites. These are review responsibilities, not
two copies of the same API contract.

Every public root manifest under `packages/` must have one canonical guide with
its `package: "@fluojs/..."` frontmatter. DI retains its Fundamentals URL.
`tooling/docs/fixtures/package-guides/*/evidence.json` connects each guide to its
owning source, executable tests, compositions, executed commands and unexecuted
scope. Presence is automated; explanatory quality still requires review against
`PACKAGE-GUIDE-STANDARD.md`.

## A package-changing PR

1. Identify behavior changes in the owning README/contracts and implementation.
2. Update the package guide and affected composition/beginner chapters.
3. Update executable examples before changing their stated outcomes.
4. Run the relevant fixture suite and typecheck; use native services when the
   guarantee depends on them.
5. Update evidence with actual results and explicit limits.
6. Review the built page, not only the Markdown diff.

An internal refactoring may require no prose change. Explain that decision in
the PR rather than changing a sentence merely to satisfy a filename check.
CI reports `DOCS_IMPACT` for changed packages and whether their canonical guide
also changed. It does not pretend that touching a file proves semantic accuracy.

## Required checks

```sh
pnpm build
pnpm typecheck
pnpm docs:examples-check
pnpm verify:docs
```

`verify:docs` checks English-only publishing, existing knowledge links, package
coverage/evidence references, retained bilingual Books, documentation types and
the production build. The normal tooling CI lanes execute the fixture tests.
Those lanes install the Bun and Deno versions used by the native examples.
The existing runtime-floor CI lanes continue to serve their separate purpose.

Machine checks do not pin prose or word counts. Do not remove a negative
regression to make an inaccurate claim pass. If source behavior contradicts its
owner contract, document the discrepancy explicitly and report the runtime
defect; a mocked example is not permission to lower the promised guarantee.

## Build a publication artifact

The latest-Node-24 CI check builds and uploads `docs-site-<commit>` as a preview
artifact. It is an ordinary Next.js standalone server, not an automatic public
deployment and not an npm package release.

To reproduce locally:

```sh
pnpm verify:docs
pnpm docs:package
pnpm docs:release-check
```

The artifact is `.artifacts/docs-site/`. Its `docs-site-manifest.json` records
the source commit, dirty-checkout flag, Node version and all package versions.
CI runs `docs:release-check --require-clean`: the packaged server must start,
all document routes and internal article links/anchors must resolve, legacy
URLs must redirect, and search must return canonical English URLs.

The smoke server defaults to port 4327; set `DOCS_SMOKE_PORT` if that port is
already owned by another local process. Startup waits for the child server's
ready event and all requests have deadlines. The verifier closes its own server.

## Release version alignment

Package pages display the version from the source manifest used by the build.
This is labeled **Source version**, not “latest published version.” Independent
package versions must not be collapsed into a fictional framework-wide version.

For a stable public site, choose the source commit associated with the released
package set, check its Changesets-generated changelogs, and verify the artifact
manifest before promotion. Unreleased changes belong in a labeled preview.
Changesets and the existing release workflow remain the sole authority for npm
publication and changelogs; this website workflow does not publish packages.

## Public promotion and rollback

Public deployment requires the maintainer's explicit authorization and hosting
target. This repository does not silently choose a hosting account or domain.
The requested handoff for this increment is a PR, not deployment.

Run the approved immutable artifact with a supported Node version:

```sh
HOSTNAME=0.0.0.0 PORT=3000 node apps/docs/server.js
```

Run that command from the extracted artifact root, not the repository checkout.
The static assets and public files are included. Verify `/docs`, a package
chapter, search and one legacy redirect on the actual deployed origin.
Retain the previously approved artifact and its manifest; rollback promotes that
artifact rather than rebuilding an old branch with current dependencies.

## Routine maintenance

On release, re-run publication checks and review version-sensitive setup pages.
During routine maintenance, prioritize repeated user questions, failed searches,
broken links and unverified native integrations. External-service credentials
are not required for the default local suite; evidence must say when a live
SMTP server, webhook, broker or hosted runtime was not exercised.

The current content inventory and evidence receipts are discovery tools, not
substitutes for code/contract review.
