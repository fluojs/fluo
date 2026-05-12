declare module 'vitest' {
  export const afterEach: typeof globalThis.afterEach;
  export const beforeEach: typeof globalThis.beforeEach;
  export const describe: typeof globalThis.describe;
  export const expect: typeof globalThis.expect;
  export const it: typeof globalThis.it;
  export const vi: typeof globalThis.vi;
}
