# bootstrap paths

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

This page records the supported bootstrap paths for Konekti after you know the canonical first-run flow.

## canonical first-run path

The recommended method is using the globally installed CLI:

```sh
pnpm add -g @konekti/cli
konekti new my-app
cd my-app
pnpm dev
```

This is the primary public onboarding path.

For one-off use without a global installation, `dlx` is also supported as a secondary path:

```sh
pnpm dlx @konekti/cli new my-app
```

While `dlx` is convenient, the global CLI installation remains the canonical entry point. There is no separate `create-konekti` wrapper; any future compatibility wrappers will be documented separately.

## next steps

After bootstrapping, the CLI prints package-manager-aware next steps. Example:

```text
cd my-app
pnpm dev
```

## input resolution

The `konekti new` command resolves inputs in the following order:

1.  **Project Name**: Provided via the `--name` flag or as a positional argument.
2.  **Package Manager**: Auto-detected or overridden with `--package-manager`.
3.  **Target Directory**: Defaults to `./<project-name>`, can be overridden with `--target-directory`.

To maintain a streamlined experience, the CLI intentionally avoids prompts for ORMs, test runners, or resource generation during the initial bootstrap.

## scaffold boundaries

The Konekti scaffolding is designed to be consistent and predictable:

- **Stable Structure**: A single project shape is used regardless of the package manager.
- **Package Manager Awareness**: Install and run commands are tailored to the detected package manager.
- **Current Directory**: Initialization within the current directory is not supported.
- **No Templates**: There are no package-manager-specific templates or scaffolds.

Any changes to these boundaries will be introduced as explicit features.

## internal verification

For development and testing of the framework itself, several internal commands are available:

```sh
pnpm --dir packages/cli run sandbox:test
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
```

These are for framework contributors and are not part of the public bootstrap API.

## further reading

- `./quick-start.md` - return to the canonical first-run guide
- `./generator-workflow.md`
- `../reference/toolchain-contract-matrix.md`
