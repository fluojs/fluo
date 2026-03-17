# open issues

<p><strong><kbd>English</kbd></strong> <a href="./open-issues.ko.md"><kbd>한국어</kbd></a></p>

This file is a convenience index for the current GitHub issue backlog.

GitHub Issues remain the source of truth for planning. This document exists only to group the current open issues, explain what each one is about, and suggest a practical execution order.

## current source of truth

- canonical planning source -> GitHub Issues in `konektijs/konekti`
- current shipped behavior -> `README.md`, `docs/`, and `packages/*/README*.md`

## recommended execution order

1. foundation and public-contract cleanup
2. bootstrap and scaffold UX
3. core runtime and validation contracts
4. transport expansion
5. auth defaults and ecosystem expansion

## issue groups

### foundation and public-contract cleanup

#### `#1` Retire `konekti-plan` as an active source and finish repo docs migration

- what it covers
  - finish the last migration work from the old planning repo into `konekti`
  - ensure `README.md`, `docs/`, and package READMEs are the only active documentation sources
  - keep historical material as history only, not active truth
- why it matters
  - this issue locks the new docs model and removes ambiguity about where current truth lives
- how to proceed
  - audit the remaining `konekti-plan` artifacts one last time
  - confirm every durable contract is either in `docs/` or a package README
  - close the issue only after no active contributor flow depends on the retired repo

#### `#10` Decide public release evolution for toolchain packages and metadata extension

- what it covers
  - future packaging of toolchain building blocks
  - support policy for third-party metadata/decorator extension
  - public-release positioning beyond the current repo docs cleanup
- why it matters
  - this affects release posture, package boundaries, and extension guarantees
- how to proceed
  - document what remains internal-only
  - define whether any tooling pieces should become public packages
  - decide how far extension support should go before advertising it

### bootstrap and scaffold UX

#### `#6` Decide scaffold evolution beyond the current CLI bootstrap flow

- what it covers
  - package-manager-specific output customization
  - current-directory initialization support
- why it matters
  - this shapes the first-run experience and starter expectations
- how to proceed
  - keep the canonical bootstrap contract stable first
  - only add scaffold options that can be documented and tested end to end

### core runtime and validation contracts

#### `#3` Plan validation and DTO evolution beyond the current decorator model

- what it covers
  - schema-object validation as a first-class path
  - richer validation adapter interfaces
- why it matters
  - request binding and validation are core DX contracts; any expansion touches docs, generators, and tests
- how to proceed
  - make this decision after `#4`, so DTO evolution follows the chosen runtime/request model

### transport expansion

#### `#9` Explore future non-HTTP transport and gateway model

- what it covers
  - non-HTTP transport boundary model
  - gateway/websocket execution model and package surface
- why it matters
  - future transports should reuse current framework contracts instead of diluting HTTP semantics prematurely
- how to proceed
  - sequence this after `#4`
  - define package boundaries, lifecycle, and ownership before implementation

### auth defaults and ecosystem expansion

#### `#7` Define the official auth product policy defaults

- what it covers
  - bearer vs HttpOnly cookie default recommendation
  - refresh-token lifecycle and rotation
  - logout/revoke behavior
  - account-linking policy across identity sources
- why it matters
  - examples, starter guidance, and public policy all depend on one coherent auth story
- how to proceed
  - keep the strategy-generic foundation
  - choose one official default story for docs/examples before expanding permutations

#### `#5` Track future support-matrix and data-layer expansion

- what it covers
  - future ORM x DB combinations
  - whether integrations remain template-level or become public packages
  - out-of-matrix candidates such as MongoDB-oriented support
- why it matters
  - support claims affect docs, CI, examples, and package shape
- how to proceed
  - require docs + tests + examples + support-tier criteria before promoting any new stack

#### `#8` Plan the next expansion of `@konekti/testing`

- what it covers
  - how far the testing API should grow
  - how rich generated test templates should become
- why it matters
  - testing should follow the supported runtime/package workflows instead of inventing them ahead of time
- how to proceed
  - sequence this after the public bootstrap/auth/support defaults are clearer
  - expand only where concrete user workflows justify new helpers

## practical next steps

If work starts now, the most efficient order is:

1. `#1`
2. `#10`
3. `#6`
4. `#3`
5. `#9`
6. `#7`
7. `#5`
8. `#8`

## maintenance rule

When an issue is resolved:

- close the GitHub issue
- update the affected `docs/` topic and package README
- update this file only if the backlog shape itself changed
