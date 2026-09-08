import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

const config = {
  // Installed pnpm dependencies remain inside this root; Fluo is copied as dist.
  turbopack: { root: process.env.FLUO_E2E_WORKTREE },
};

// The legacy mode reproduces the unscoped SSR import failure. The preserve mode
// tests output identity independently of scope; normal consumers need no rules.
export default withFluoNextBackend(config,
  process.env.FLUO_E2E_COMPILER === 'legacy' ? {}
    : process.env.FLUO_E2E_COMPILER === 'preserve' ? { preserveModulePaths: true }
      : {
        include: /(?:^|\/)(?:shared-)?backend\.ts$/u,
        exclude: '**/*.test.ts',
        preserveModulePaths: process.env.FLUO_E2E_COMPILER !== 'scope-only',
      });
