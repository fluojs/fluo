# tooling-vite

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Private Vite tooling for repository tests. Applications should use the public [@fluojs/vite](../../packages/vite/README.md) plugin.

## Start here

`fluoBabelDecoratorsPlugin()` in [src/index.ts](./src/index.ts) passes the repository [Babel configuration](../babel/babel.config.cjs), source maps, and the `test` transform boundary to the public `fluoDecoratorsPlugin`. The [shared Vitest configuration](../vitest/src/index.ts) consumes this function.

Do not copy this internal wrapper into a generated app. Follow the [toolchain contract](../../docs/reference/toolchain-contract-matrix.md) and the public plugin's configuration instead.
