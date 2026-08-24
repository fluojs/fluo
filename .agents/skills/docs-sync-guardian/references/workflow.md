# Native docs review workflow

## Input

- One PR URL or number.
- Optional linked issue.
- Base branch, defaulting to `main`.

Collect the current PR head and changed-file list, then dispatch one read-only
reviewer task using `guardian.md`.

## Output

```text
verdict: pass | block | needs-human-check
reviewed_head: <40-character sha>
findings: <typed evidence list>
```

Reject multiple PRs, missing head identity, malformed output, or stale results.
A verdict is evidence only and never grants merge authority.
