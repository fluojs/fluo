---
"@fluojs/cli": major
"@fluojs/vite": major
"@fluojs/platform-nextjs": major
"@fluojs/discord": patch
"@fluojs/email": patch
"@fluojs/slack": patch
---

Upgrade the compiler toolchain to Babel 8 and raise its Node.js floor.

`@fluojs/vite` now requires Babel 8 peers (`@babel/core` `>=8.0.0`, `@babel/plugin-proposal-decorators` `>=8.0.0`, `@babel/preset-typescript` `>=8.0.0`), `@fluojs/platform-nextjs` ships Babel 8 dependencies (`@babel/core` `^8.0.6`, `@babel/plugin-proposal-decorators` `^8.0.2`, `@babel/preset-typescript` `^8.0.1`), and CLI-generated projects install the same Babel 8 baseline without passing the removed `allowDeclareFields` preset option. The TC39 `{ version: '2023-11' }` decorator transform and decorated field behavior are preserved, and the `@babel/core@<8` override keeps third-party Babel 7 resolutions pinned to the security-fixed 7.29.7 line.

These compiler toolchain packages and generated compiler-toolchain projects now require Node.js `>=24.11.0 <27` (Babel 8's own upstream floor; Node 22 stays excluded). Other Node runtime packages keep `>=24.0.0 <27`, and CI moves the exact `24.0.0` verification to a separately required runtime-only lane that executes real built-runtime imports and HTTP/listener/config behavior on artifacts built under a supported compiler Node without loading Babel 8. Migrate hosts and configs with the updated [Node.js support guide](../../docs/reference/node-support.md) and [Node 24 migration guide](../../docs/getting-started/migrate-node24.md) (Korean: `node-support.ko.md`, `migrate-node24.ko.md`) before upgrading.

Parenthesize conditional async transport factories in Discord, Email, and Slack for Babel 8 parser compatibility without changing their runtime APIs or supported runtime floors.
