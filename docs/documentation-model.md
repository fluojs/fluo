# documentation model

<p><strong><kbd>English</kbd></strong> <a href="./documentation-model.ko.md"><kbd>한국어</kbd></a></p>


This file defines the target documentation model for `konekti` after retiring phase-oriented planning docs as an active source of truth.

## goals

- keep current product truth in the implementation repo
- move active planning and follow-up work to GitHub Issues
- make the root `README.md` the project entrypoint, not a phase ledger
- use `docs/` for topic-level framework guides
- use package READMEs for package-local APIs, examples, and caveats
- reduce duplicated authority between repo docs and historical planning docs

## authority model

### 1. root `README.md`

The root README should answer:

- what Konekti is
- who it is for
- the fastest way to start
- which packages make up the public framework surface
- where to go next in `docs/`
- the short decision narrative behind the current shape of the framework

The root README should not track phase status, subphase completion, or backlog state.

### 2. `docs/`

`docs/` should hold cross-package, user-facing framework documentation.

Examples:

- getting started and bootstrap flow
- framework architecture overview
- HTTP runtime behavior
- auth and JWT strategy model
- OpenAPI behavior
- metrics, health, and readiness
- testing and release workflows
- public toolchain contract

`docs/` is the durable home for "how the framework works today" at the system level.

### 3. `packages/*/README.md` and `README.ko.md`

Each package README should own package-local truth:

- install instructions
- quick start examples
- public exports and contracts
- package-specific caveats
- links back to higher-level docs when the topic spans multiple packages

Package READMEs should not re-explain framework-wide ownership boundaries in full.

### 4. GitHub Issues

GitHub Issues should own active planning:

- backlog items
- follow-up work
- feature proposals
- docs debt
- release tasks
- design discussions that are not yet committed into the stable documentation set

If something describes future work rather than current behavior, it belongs in an Issue rather than in `docs/`.

## target directory model

```text
konekti/
├── README.md                         # project entrypoint
├── docs/
│   ├── getting-started/
│   │   ├── quick-start.md
│   │   ├── bootstrap-paths.md
│   │   └── generator-workflow.md
│   ├── concepts/
│   │   ├── architecture-overview.md
│   │   ├── http-runtime.md
│   │   ├── di-and-modules.md
│   │   ├── auth-and-jwt.md
│   │   ├── openapi.md
│   │   ├── observability.md
│   │   └── transactions.md
│   ├── operations/
│   │   ├── testing-guide.md
│   │   ├── release-governance.md
│   │   └── manifest-decision.md
│   └── reference/
│       ├── package-surface.md
│       ├── toolchain-contract-matrix.md
│       ├── support-matrix.md
│       └── naming-and-file-conventions.md
└── packages/*/README*.md             # package-level truth
```

The exact filenames can change, but the ownership split should remain stable:

- `README.md` -> project entry and decision summary
- `docs/` -> cross-package current truth
- `packages/*/README*` -> package truth
- Issues -> planning

## migration rules

### move into `docs/`

Content from `konekti-plan` should move into `docs/` when it describes:

- stable architecture boundaries
- runtime behavior that users or contributors need to understand today
- package interaction rules
- documented public toolchain contracts
- canonical bootstrap and generator flows

### move into package READMEs

Content should move into a package README when it describes:

- a single package's API
- setup steps for one package
- examples scoped to one package
- package-specific errors, defaults, or caveats

### move into GitHub Issues

Content should become Issues when it describes:

- not-yet-shipped work
- candidate improvements
- release follow-ups
- docs gaps that still need writing
- sequencing or backlog order

### archive or drop

Phase/subphase docs should be archived or dropped from active read order when they are primarily:

- delivery history
- superseded execution notes
- stale acceptance criteria for already-shipped work
- roadmap sequencing that no longer reflects repo reality

## immediate migration map

### root README

Rewrite `README.md` around these sections:

1. What is Konekti?
2. Quick start
3. Public package families
4. Core usage flow (`konekti new`, runtime bootstrap, generators)
5. Why the framework is shaped this way
6. Docs index

### docs to add or reshape

- convert `docs/concepts/architecture-overview.md` into the top-level concepts entry
- split topic-heavy material from `konekti-plan/architecture/*` into `docs/concepts/*`
- move prompt/bootstrap/toolchain references from `konekti-plan/reference/*` into `docs/getting-started/*` or `docs/reference/*`
- keep release/testing guidance in `docs/operations/*`

### package READMEs

- keep current package README ownership model
- remove framework-wide duplication from package docs over time
- add short links from package docs to the matching `docs/` guide when the topic spans packages

## read order after migration

1. `README.md`
2. `docs/getting-started/quick-start.md`
3. `docs/concepts/architecture-overview.md`
4. package README for the package being used
5. topic-specific docs in `docs/concepts/` or `docs/operations/`

## maintenance rules

- if a doc describes shipped behavior, it cannot live only in an Issue
- if a doc describes future work, it should not live only in `docs/`
- every package surface change should update the package README and any affected `docs/` topic in the same PR
- the root README should stay short and navigational; details belong in `docs/` and package READMEs

## non-goals

- recreating a new private plan repo with the same phase structure
- using `docs/` as a backlog tracker
- copying all historical phase detail into the active docs tree

## first implementation steps

1. rewrite the root `README.md` as the project hub
2. create `docs/getting-started/`, `docs/concepts/`, `docs/operations/`, and `docs/reference/`
3. migrate durable material from `konekti-plan/architecture/*` and `konekti-plan/reference/*`
4. convert remaining live follow-ups into GitHub Issues
5. remove `execution/` from the default documentation read path
