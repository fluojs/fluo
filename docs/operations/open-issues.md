# open issues

<p><strong><kbd>English</kbd></strong> <a href="./open-issues.ko.md"><kbd>한국어</kbd></a></p>

This file is a convenience index for the current GitHub issue backlog.

GitHub Issues remain the source of truth for planning. This document exists only to group the current open issues, explain what each one is about, and suggest a practical execution order.

## current source of truth

- canonical planning source -> GitHub Issues in `konektijs/konekti`
- current shipped behavior -> `README.md`, `docs/`, and `packages/*/README*.md`

## recommended execution order

1. bootstrap and scaffold UX
2. core runtime and validation contracts
3. transport expansion
4. auth defaults and ecosystem expansion

## issue groups

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

1. `#9`
2. `#7`
3. `#5`
4. `#8`

## maintenance rule

When an issue is resolved:

- close the GitHub issue
- update the affected `docs/` topic and package README
- update this file only if the backlog shape itself changed
