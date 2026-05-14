# Custom agent templates

Use this file as the local standard for new `.opencode/agents/*.md` files.

## Naming rules

- Every custom agent name MUST start with `fluo-`.
- Do NOT use OMO built-in names or close collisions:
  - `oracle`
  - `librarian`
  - `explore`
  - `momus`
  - `metis`
  - `sisyphus`
  - `prometheus`

## Read-only reviewer / auditor / guardian template

```md
---
description: fluo-<role> reviews a change set read-only and reports only real risk
mode: subagent
model: <strong-model-or-default>
temperature: 0.1
permission:
  read: allow
  grep: allow
  glob: allow
  list: allow
  edit: deny
  bash:
    '*': ask
    'find *': deny
    'xargs *': deny
    'git status*': allow
    'git diff*': allow
    'git log*': allow
    'git ls-files*': allow
    # Prefer git ls-files for repeatable package file lists.
    # Add exact find commands only for observed safe read-only prompts.

    'sort*': allow
    'gh pr view*': allow
    'gh pr diff*': allow
    'gh pr checks*': allow
    'gh run view*': allow
    'gh issue view*': allow
    'gh issue list*': allow
    'gh label list*': allow
    'gh issue create*': deny
    'gh issue edit*': deny
    'gh issue comment*': deny
    'gh issue close*': deny
    'gh issue reopen*': deny
    'gh pr merge*': deny
    'gh pr edit*': deny
    'gh pr review*': deny
    'gh pr close*': deny
    'gh pr reopen*': deny
    'gh run cancel*': deny
    'gh run rerun*': deny
    'gh label create*': deny
    'gh label edit*': deny
    'gh label delete*': deny
  webfetch: deny
---

You are a fluo-<role> custom agent.

Rules:
- Stay read-only.
- Do not edit files.
- Do not claim permission boundaries in prompt text alone; enforce them in frontmatter.
- Do not run `find`, `xargs`, broad shell pipelines, shell redirection, or `-exec`; use `read`, `grep`, `glob`, `list`, or `git ls-files*` instead.
- Report only concrete issues with evidence.
```

## Optional worktree-scoped implementer template

```md
---
description: fluo-<role> implements one scoped task inside an isolated worktree
mode: subagent
model: <strong-model-or-default>
temperature: 0.2
permission:
  read: allow
  grep: allow
  glob: allow
  list: allow
  edit: ask
  bash:
    '*': ask
    'find *': deny
    'xargs *': deny
    'git status*': allow
    'git diff*': allow
    'git log*': allow
    'git ls-files*': allow
    # Prefer git ls-files for repeatable package file lists.
    # Add exact find commands only for observed safe read-only prompts.

    'sort*': allow
    'git worktree*': allow
    'pnpm test*': allow
    'pnpm typecheck*': allow
    'gh issue view*': allow
    'gh issue list*': allow
    'gh label list*': allow
    'git merge*': deny
    'git rebase*': deny
    'git push*': deny
    'npm publish*': deny
    'pnpm publish*': deny
    'gh issue create*': deny
    'gh issue edit*': deny
    'gh issue comment*': deny
    'gh issue close*': deny
    'gh issue reopen*': deny
    'gh pr merge*': deny
    'gh pr edit*': deny
    'gh pr review*': deny
    'gh pr close*': deny
    'gh pr reopen*': deny
    'gh run cancel*': deny
    'gh run rerun*': deny
    'gh label create*': deny
    'gh label edit*': deny
    'gh label delete*': deny
  webfetch: deny
---

You are a fluo-<role> implementer.

Rules:
- Work only inside the assigned worktree.
- Do not merge, publish, or clean up shared branches.
- Do not take ownership of review or release gates.
- Ask before any risky shell action.
```

## Invocation guidance

- Commands and harnesses should invoke custom agents explicitly via `@fluo-*` or via command `agent:` fields.
- Do not rely on implicit name matching.
- Keep reviewer templates separate from write-capable implementers.
- Prefer one role per file.

## GitHub CLI permission policy

- Add only read-only `gh` allow patterns that match the agent's role.
- Use `gh issue view*` for linked issue context collection; this covers commands such as `gh issue view 1876 --json number,title,state,body,url,labels`.
- Keep mutating `gh` commands explicitly denied so agents fail closed instead of prompting for state-changing actions.
- Do not allow `gh pr merge*`, `gh pr review*`, `gh issue comment*`, `gh issue close*`, `gh run cancel*`, or label mutation commands in reviewer/auditor/guardian agents.

## Read-only shell discovery policy

- Prefer OpenCode `read`, `grep`, `glob`, and `list` tools when available.
- Prefer `git ls-files <path> | sort` over `find` for repeatable repository file lists.
- Do not add wildcard-tailed `find` allow patterns such as `find * -type f*`; they can also match `-delete`, `-exec`, redirection, or `xargs` tails.
- Add exact `find <absolute-path> -type f | sort` allow patterns only for observed safe read-only prompts.
- Do not add broad `find *`, shell redirection, `xargs`, `-delete`, or `-exec` patterns to reviewer/auditor/guardian agents.
