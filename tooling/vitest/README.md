# tooling-vitest

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Private shared configuration for repository tests, distinct from the test configuration in generated apps.

## Start here

- [src/index.ts](./src/index.ts): `createFluoVitestWorkspaceConfig()` composes decorator transforms, workspace source aliases, metadata preparation, and the Node test environment.
- [Root vitest.config.ts](../../vitest.config.ts): project-specific test selection and additional settings.
- [Core vitest.config.ts](../../packages/core/vitest.config.ts): an example of package-level configuration.

Repository tests using source aliases verify current source, not published npm package compatibility. See [@fluojs/testing](../../packages/testing/README.md) for application testing and the [contributing guide](../../CONTRIBUTING.md) for repository commands.
