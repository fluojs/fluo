# tooling-babel

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This directory contains private repository development tools, not a public package to install in an application.

## Start here

- [babel.config.cjs](./babel.config.cjs): TypeScript stripping and standard decorator transformation settings.
- [Core build scripts](../../packages/core/package.json): a package build using the shared configuration.
- [Babel 8 checks](./babel8-baseline.test.ts): regression coverage for transform order and execution results.

To build an application, use the [root quick start](../../README.md#quick-start). Supported transform combinations follow the [toolchain contract](../../docs/reference/toolchain-contract-matrix.md).
