import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPreparedBuild } from '../../ci/prepared-build.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const buildClosureScript = fileURLToPath(new URL('../../scripts/run-workspace-build-closure.mjs', import.meta.url));

export default function preparePackagesProjectEmittedArtifacts() {
  if (verifyPreparedBuild(repoRoot, process.env.FLUO_VERIFIED_BUILD)) return;
  for (const packageName of ['@fluojs/terminus', '@fluojs/prisma']) {
    execFileSync(process.execPath, [buildClosureScript, packageName], {
      cwd: repoRoot,
      killSignal: 'SIGTERM',
      stdio: 'inherit',
      timeout: 60_000,
    });
  }
}
