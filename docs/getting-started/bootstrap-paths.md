# bootstrap paths

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>


This file documents the current supported ways to bootstrap and verify a Konekti app.

## public bootstrap path

Use the CLI package directly:

```sh
pnpm dlx @konekti/cli new my-app
```

This is the canonical public bootstrap path.

There is no separate public `create-konekti` wrapper in the current supported contract. If a compatibility wrapper ever ships later, it must be documented as an additive surface rather than an implied alias.

## current input flow

`konekti new` currently resolves inputs in this order:

1. project name (`--name` or positional)
2. package manager (`--package-manager` override, otherwise auto-detected)
3. target directory (`--target-directory` override, otherwise `./<project-name>`)

What it intentionally does not ask:

- no ORM or database choice prompt
- no test-runner choice prompt
- no install-skip prompt
- no bundled `g resource` generator flow

## current scaffold boundary

The current public scaffold contract stays intentionally narrow:

- one stable generated project shape across supported package managers
- package-manager-aware install and run commands
- no current-directory initialization contract today
- no package-manager-specific scaffold/template divergence today

If either current-directory init or package-manager-specific output ever becomes official later, it should be added as an explicit supported surface rather than an implied convenience.

## repo-local smoke path

The implementation repo also keeps repo-local verification commands:

```sh
pnpm --dir packages/cli run sandbox:test
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
```

These are implementation/testing helpers, not the public bootstrap contract.

## next-step command shape

The scaffold prints package-manager-aware next steps, for example:

```text
cd my-app
pnpm dev
```

## related docs

- `./quick-start.md`
- `./generator-workflow.md`
- `../reference/naming-and-file-conventions.md`
