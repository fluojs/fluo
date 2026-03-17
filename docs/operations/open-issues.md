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

### auth defaults and ecosystem expansion

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

1. `#8`

## maintenance rule

When an issue is resolved:

- close the GitHub issue
- update the affected `docs/` topic and package README
- update this file only if the backlog shape itself changed
