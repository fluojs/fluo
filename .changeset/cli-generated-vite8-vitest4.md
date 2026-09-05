---
"@fluojs/cli": minor
"@fluojs/vite": patch
---

Generate new non-Deno projects with Vite ^8.2.2, Vitest ^4.1.11, and matching @vitest/coverage-v8 ^4.1.11. Generated ESM Vite configs use Rolldown options while retaining the Babel application decorator plugin and the separate Vitest testing transform. React SSR keeps decorated declarations in .ts files and JSX in .tsx files.

Existing projects are not rewritten. When adopting the new generated toolchain, update the three dependency ranges together, rename build.rollupOptions to build.rolldownOptions, and retain fluoDecoratorsPlugin() and fluoBabelDecoratorsPlugin(); direct Oxc/esbuild decorator processing is unsupported. Remove the generated Babel ignore rule for src/**/*.test.ts so the testing plugin can transform decorators declared inside tests instead of leaving them to the default compiler. The Node.js >=24.0.0 <27 policy and Bun/Deno/Workers runtime metadata are unchanged.

The @fluojs/vite patch updates its shipped README pair to distinguish the generated Vite 8/Vitest 4 baseline from its unchanged Vite >=6.2.0 peer range. It does not change the plugin API or transform behavior.
