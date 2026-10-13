# tooling-tsconfig

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This directory contains private repository development configuration. Do not install it as a separate application package.

## Start here

[base.json](./base.json) defines shared compiler options, including strict checking, ES2022/ESNext, and Bundler module resolution. Read each consuming `tsconfig`'s `extends` and overrides to determine its effective configuration. This configuration alone does not transform decorator code.

The [CLI starter](../../packages/cli/README.md) supplies TypeScript and transform settings for a new app. See the [contributing guide](../../CONTRIBUTING.md) for repository build and verification steps.
