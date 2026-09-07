import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

export default withFluoNextBackend({
  // Installed pnpm dependencies remain inside this root; Fluo is copied as dist.
  turbopack: { root: process.env.FLUO_E2E_WORKTREE },
});
